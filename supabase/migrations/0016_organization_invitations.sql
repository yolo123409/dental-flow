-- DentalFlow Enterprise, Phase 4: organization invitations (Partner /
-- Manager / Viewer). Mirrors staff_invitations (0008) closely: same
-- plaintext-token pattern (lib/generateToken.ts, never Postgres
-- gen_random_bytes() - see 0008's own comment for why), same SECURITY
-- DEFINER RPC shape, same accept-by-matching-JWT-email security check,
-- same select/delete-only RLS (writes only through the RPCs below).
--
-- One deliberate difference from staff_invitations: there is no
-- full_name column here. The CEO's invite form only collects
-- Email/Role/Branch Access - the INVITEE supplies their own full name at
-- acceptance time (p_full_name on accept_organization_invitation), not
-- pre-filled by the inviter.
--
-- Safe to re-run: every statement is idempotent (create table if not
-- exists / create or replace / drop policy if exists), matching every
-- other migration in this folder.

-- ============================================================
-- 1. organization_invitations
-- ============================================================

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  email text not null,
  role text not null check (role in ('Partner', 'Manager', 'Viewer')),
  branch_access text not null check (branch_access in ('all', 'selected')),

  -- 256-bit random token, generated client-side (lib/generateToken.ts) and
  -- passed in as p_token - never generated in Postgres. Kept (not nulled)
  -- after acceptance so the invite page can tell "already accepted" apart
  -- from "not found"; the accepted_at check is what actually makes it
  -- unusable.
  token text not null unique,

  invited_by uuid references public.organization_users(id) on delete set null,

  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_organization_invitations_organization_id
  on public.organization_invitations(organization_id);

create index if not exists idx_organization_invitations_email
  on public.organization_invitations(lower(email));

-- One active (unaccepted) invitation per email per organization.
create unique index if not exists uq_organization_invitations_pending_email_per_org
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

alter table public.organization_invitations enable row level security;

-- Reads and cancellation go through normal RLS. Creating, resending and
-- accepting go through SECURITY DEFINER RPCs only - deliberately no
-- insert/update policy here, so those are the only doors into writing
-- this table.

drop policy if exists "organization_invitations_select_ceo_only" on public.organization_invitations;
create policy "organization_invitations_select_ceo_only"
  on public.organization_invitations for select
  using (public.is_organization_ceo(organization_invitations.organization_id));

drop policy if exists "organization_invitations_delete_ceo_only" on public.organization_invitations;
create policy "organization_invitations_delete_ceo_only"
  on public.organization_invitations for delete
  using (public.is_organization_ceo(organization_invitations.organization_id));

-- ============================================================
-- 2. organization_invitation_branches - staged branch selection for a
--    'selected'-access invitation, copied into organization_user_branches
--    by accept_organization_invitation once the invitee accepts.
-- ============================================================

create table if not exists public.organization_invitation_branches (
  id uuid primary key default gen_random_uuid(),

  invitation_id uuid not null
    references public.organization_invitations(id) on delete cascade,

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  unique (invitation_id, clinic_id)
);

create index if not exists idx_organization_invitation_branches_invitation_id
  on public.organization_invitation_branches(invitation_id);

alter table public.organization_invitation_branches enable row level security;

drop policy if exists "organization_invitation_branches_select_ceo_only" on public.organization_invitation_branches;
create policy "organization_invitation_branches_select_ceo_only"
  on public.organization_invitation_branches for select
  using (
    exists (
      select 1 from public.organization_invitations oi
      where oi.id = organization_invitation_branches.invitation_id
        and public.is_organization_ceo(oi.organization_id)
    )
  );

-- ============================================================
-- 3. create_organization_invitation - the only way an organization
--    invitation is created. Derives the caller's own organization from
--    their CEO membership (never trusts a client-supplied organization
--    id), and - critically - verifies every selected branch actually
--    belongs to that same organization before staging it, closing the
--    cross-org gap Phase 2's migration comment flagged but left
--    unenforced.
-- ============================================================

create or replace function public.create_organization_invitation(
  p_email text,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[],
  p_token text
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_org_id uuid;
  v_caller_org_user_id uuid;
  v_email text := lower(trim(p_email));
  v_invitation_id uuid;
  v_expires_at timestamptz;
  v_branch_id uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select organization_id, id into v_caller_org_id, v_caller_org_user_id
  from public.organization_users
  where user_id = v_uid and status = 'Active' and role = 'CEO';

  if v_caller_org_id is null then
    raise exception 'Only the organization''s CEO can invite members';
  end if;

  if p_role not in ('Partner', 'Manager', 'Viewer') then
    raise exception 'Invalid role';
  end if;

  if p_branch_access not in ('all', 'selected') then
    raise exception 'Invalid branch access';
  end if;

  if p_branch_access = 'selected'
     and (p_branch_ids is null or array_length(p_branch_ids, 1) is null) then
    raise exception 'Select at least one branch';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please provide a valid email address';
  end if;

  if exists (
    select 1 from public.organization_users
    where organization_id = v_caller_org_id and lower(email) = v_email
  ) then
    raise exception 'This person is already a member of this organization';
  end if;

  if exists (
    select 1 from public.organization_users where lower(email) = v_email
  ) then
    raise exception 'This email already belongs to a member of another organization';
  end if;

  delete from public.organization_invitations
  where organization_id = v_caller_org_id
    and lower(email) = v_email
    and accepted_at is null
    and organization_invitations.expires_at < now();

  if exists (
    select 1 from public.organization_invitations
    where organization_id = v_caller_org_id
      and lower(email) = v_email
      and accepted_at is null
  ) then
    raise exception 'An invitation is already pending for this email';
  end if;

  if p_branch_access = 'selected' then
    if exists (
      select 1
      from unnest(p_branch_ids) as bid
      left join public.clinics c
        on c.id = bid and c.organization_id = v_caller_org_id
      where c.id is null
    ) then
      raise exception 'One or more selected branches are invalid';
    end if;
  end if;

  v_expires_at := now() + interval '7 days';

  insert into public.organization_invitations (
    organization_id, email, role, branch_access, token, invited_by, expires_at
  )
  values (
    v_caller_org_id, v_email, p_role, p_branch_access, p_token,
    v_caller_org_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  if p_branch_access = 'selected' then
    foreach v_branch_id in array p_branch_ids loop
      insert into public.organization_invitation_branches (invitation_id, clinic_id)
      values (v_invitation_id, v_branch_id);
    end loop;
  end if;

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_organization_invitation(text, text, text, uuid[], text)
  to authenticated;

-- ============================================================
-- 4. resend_organization_invitation - regenerates the token and expiry on
--    the same row (old link stops working the moment this runs).
-- ============================================================

create or replace function public.resend_organization_invitation(
  p_invitation_id uuid,
  p_token text
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation_org_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  select organization_id into v_invitation_org_id
  from public.organization_invitations
  where id = p_invitation_id;

  if v_invitation_org_id is null or not public.is_organization_ceo(v_invitation_org_id) then
    raise exception 'Invitation not found';
  end if;

  v_expires_at := now() + interval '7 days';

  update public.organization_invitations
  set token = p_token, expires_at = v_expires_at
  where id = p_invitation_id and accepted_at is null;

  if not found then
    raise exception 'This invitation has already been accepted';
  end if;

  return query select p_token, v_expires_at;
end;
$$;

grant execute on function public.resend_organization_invitation(uuid, text) to authenticated;

-- ============================================================
-- 5. get_organization_invitation_details - the ONLY thing an
--    unauthenticated visitor to /org-invite/[token] can read. Returns the
--    organization NAME, never organization_id, and nothing about any
--    other invitation.
-- ============================================================

create or replace function public.get_organization_invitation_details(p_token text)
returns table (
  email text,
  role text,
  branch_access text,
  organization_name text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select oi.email, oi.role, oi.branch_access, o.name, oi.expires_at, oi.accepted_at
  from public.organization_invitations oi
  join public.organizations o on o.id = oi.organization_id
  where oi.token = p_token;
end;
$$;

grant execute on function public.get_organization_invitation_details(text) to anon, authenticated;

-- ============================================================
-- 6. accept_organization_invitation - the deliberate SECURITY DEFINER
--    bypass for this feature, same shape as accept_staff_invitation: a
--    brand new user has no organization_users row yet, so nothing else
--    can create one for them. Must be called AFTER
--    supabase.auth.signUp() establishes a session, so auth.uid()/
--    auth.jwt() resolve to the invited account.
--
--    Preserves the ≤1-organization-per-user assumption the same way
--    create_organization_with_ceo does - raises if the caller already
--    has ANY organization_users row.
-- ============================================================

create or replace function public.accept_organization_invitation(
  p_token text,
  p_full_name text
)
returns table (organization_id uuid, organization_user_id uuid, role text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_email text;
  v_invitation record;
  v_organization_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if exists (select 1 from public.organization_users where user_id = v_uid) then
    raise exception 'This account is already linked to an organization';
  end if;

  select * into v_invitation
  from public.organization_invitations
  where token = p_token
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'This invitation has already been accepted';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'This invitation has expired';
  end if;

  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_caller_email = '' or v_caller_email <> lower(v_invitation.email) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  insert into public.organization_users (
    organization_id, user_id, full_name, email, role, branch_access, status, invited_by
  )
  values (
    v_invitation.organization_id, v_uid, trim(p_full_name), v_invitation.email,
    v_invitation.role, v_invitation.branch_access, 'Active', v_invitation.invited_by
  )
  returning id into v_organization_user_id;

  if v_invitation.branch_access = 'selected' then
    insert into public.organization_user_branches (organization_user_id, clinic_id)
    select v_organization_user_id, clinic_id
    from public.organization_invitation_branches
    where invitation_id = v_invitation.id;
  end if;

  update public.organization_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return query select
    v_invitation.organization_id, v_organization_user_id, v_invitation.role, trim(p_full_name);
end;
$$;

grant execute on function public.accept_organization_invitation(text, text) to authenticated;
