-- ============================================================
-- MULTI-BRANCH ORGANIZATIONS - rebuilt from a clean foundation after the
-- full rollback in migration 0048 (see that file's header for exactly
-- what was removed and why). This is NOT a restoration of the old
-- design - the old design modified existing clinic-scoped RLS policies
-- (clinics_select_own, clinics_update_admin_only, clinic_users_* staff
-- management) to add organization-awareness, and separately corrupted
-- AuthContext's `profile` state as a side-channel "needs to pick a
-- branch" signal. Both were root causes of the breakage this rebuild is
-- explicitly avoiding.
--
-- CORE DESIGN DECISION: a branch is nothing more than an ordinary
-- `clinics` row with a non-null `organization_id`, and a person's access
-- to a branch is nothing more than an ordinary `clinic_users` row in
-- that clinic (the CEO gets role='Owner' in every branch they create or
-- that's created for them). Every existing clinic-scoped RLS policy
-- already grants access purely by "does a clinic_users row exist for
-- (auth.uid(), clinic_id)" - so a branch is automatically, correctly
-- accessible under every existing policy with ZERO changes to any of
-- them. This migration adds exactly two new tables and a fully-additive
-- set of new functions/policies; it does not alter the body of any
-- existing policy or function - including get_invitation_details, which
-- stays byte-for-byte as migration 0008 defined it (Postgres rejects
-- changing an existing function's return columns via CREATE OR REPLACE
-- anyway; see get_organization_invitation_details below, a separate
-- function rather than a modification of it).
--
-- organization_user_branches (suggested in the spec) is deliberately NOT
-- created - clinic_users already IS the branch-membership table. A
-- separate join table would just be a second source of truth that could
-- drift out of sync with real clinic_users rows, which is exactly the
-- kind of "database cleanup issue" being avoided this time.
-- ============================================================

-- ============================================================
-- 1. organizations
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- ============================================================
-- 2. clinics.organization_id - nullable. NULL (the default, and the
--    value on every existing row) means "independent clinic", untouched
--    by anything in this migration. Non-null means "this clinic is a
--    branch of that organization".
-- ============================================================

alter table public.clinics
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_clinics_organization_id on public.clinics(organization_id) where organization_id is not null;

-- ============================================================
-- 3. organization_users - org-wide roster. auth_user_id is globally
--    unique (one organization per person, mirroring the existing
--    one-clinic-per-person convention enforced procedurally in
--    create_clinic_with_admin/accept_staff_invitation - a person is
--    either a plain independent-clinic user with zero rows here, or a
--    multi-branch org member with exactly one row here and one
--    clinic_users row per branch they've been granted).
--
--    role: 'CEO' is the org-level capability flag (branch creation,
--    branch/staff management, consolidated accounting). 'Member' covers
--    every other person who has ever accepted a branch invitation - it
--    grants NO org-level capability by itself; their real permissions
--    are entirely branch-scoped via their own clinic_users.role in each
--    branch, exactly like an independent clinic's staff. 'Member' rows
--    exist so the CEO can look up and re-assign an existing org
--    colleague to an additional branch without a fresh email invite.
--
--    active_clinic_id: a server-persisted UX default for "which branch
--    is currently selected", NEVER a security boundary - actual data
--    access is always still gated by a real clinic_users row (see
--    getCurrentClinicUser's resolution in services/clinicUsers.ts).
-- ============================================================

create table if not exists public.organization_users (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid not null,

  role text not null check (role in ('CEO', 'Member')),

  active_clinic_id uuid references public.clinics(id) on delete set null,

  created_at timestamptz not null default now(),

  unique (auth_user_id)
);

create index if not exists idx_organization_users_organization_id on public.organization_users(organization_id);

alter table public.organization_users enable row level security;

-- ============================================================
-- 4. is_organization_ceo - same self-referential-RLS-recursion fix as
--    is_clinic_owner_or_admin (migration 0008): a policy ON
--    organization_users cannot directly EXISTS-query organization_users
--    itself without Postgres rejecting it (42P17, "infinite recursion
--    detected in policy"). MUST be plpgsql (not sql), for the same
--    inlining reason documented in 0008 - a `language sql` function this
--    simple gets inlined by the planner, silently discarding the
--    SECURITY DEFINER bypass and reproducing the same recursion.
-- ============================================================

create or replace function public.is_organization_ceo(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.organization_users ou
    where ou.auth_user_id = auth.uid()
      and ou.organization_id = p_organization_id
      and ou.role = 'CEO'
  );
end;
$$;

grant execute on function public.is_organization_ceo(uuid) to authenticated;

-- ============================================================
-- 5. organizations RLS - readable by any member (CEO or Member) of that
--    organization. No client insert/update/delete policy - writes only
--    happen through the SECURITY DEFINER RPCs below, same convention as
--    staff_invitations (0008) and clinical_codes (0054).
-- ============================================================

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_users ou
      where ou.auth_user_id = auth.uid()
        and ou.organization_id = organizations.id
    )
  );

-- ============================================================
-- 6. organization_users RLS - a member can always read their own row
--    (needed for "am I a CEO / do I have other branches" checks); a CEO
--    can additionally read every row in their own organization (needed
--    for the roster/"assign existing organization user to a branch"
--    feature). No client insert/update/delete policy - writes only
--    happen through the RPCs below.
-- ============================================================

drop policy if exists "organization_users_select_self_or_ceo" on public.organization_users;
create policy "organization_users_select_self_or_ceo"
  on public.organization_users for select
  using (
    auth_user_id = auth.uid()
    or public.is_organization_ceo(organization_users.organization_id)
  );

-- ============================================================
-- 7. _provision_new_clinic - internal helper factored out of
--    create_clinic_with_admin's body (that function itself is left
--    completely untouched - the independent-clinic signup path is
--    zero-risk under this migration) so branch provisioning can reuse
--    the exact same clinic/clinic_settings/clinic_roles seeding, once,
--    instead of duplicating it across create_organization_with_ceo and
--    create_branch. No `authenticated` grant - not part of the public
--    RPC surface, only callable from other SECURITY DEFINER functions
--    in this file.
-- ============================================================

create or replace function public._provision_new_clinic(
  p_clinic_name text,
  p_email text,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  insert into public.clinics (name, email, plan, organization_id)
  values (trim(p_clinic_name), p_email, 'free', p_organization_id)
  returning id into v_clinic_id;

  insert into public.clinic_settings (clinic_id, clinic_name, email)
  values (v_clinic_id, trim(p_clinic_name), p_email);

  insert into public.clinic_roles (clinic_id, name, permissions, is_system)
  values
    (v_clinic_id, 'Owner', '["*"]'::jsonb, true),
    (v_clinic_id, 'Admin', '["*"]'::jsonb, true),
    (v_clinic_id, 'Dentist',
      '["dashboard","patients","appointments","calendar","treatments","documents"]'::jsonb,
      true),
    (v_clinic_id, 'Receptionist',
      '["dashboard","patients","appointments","calendar","billing","payments"]'::jsonb,
      true);

  return v_clinic_id;
end;
$$;

-- ============================================================
-- 8. create_organization_with_ceo - the multi-branch onboarding path.
--    Same preconditions as create_clinic_with_admin (caller must be
--    authenticated and not already linked to a clinic anywhere) so a
--    person can never end up simultaneously an independent-clinic owner
--    and a CEO. The CEO becomes 'Owner' of the initial branch, exactly
--    like an independent clinic's creator - not a separate role, not a
--    special case anywhere downstream.
-- ============================================================

create or replace function public.create_organization_with_ceo(
  p_organization_name text,
  p_branch_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null
)
returns table (organization_id uuid, clinic_id uuid, clinic_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_clinic_id uuid;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_organization_name is null or length(trim(p_organization_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  if p_branch_name is null or length(trim(p_branch_name)) = 0 then
    raise exception 'Branch name is required';
  end if;

  if exists (select 1 from public.clinic_users where auth_user_id = v_uid) then
    raise exception 'This account is already linked to a clinic';
  end if;

  if exists (select 1 from public.organization_users where auth_user_id = v_uid) then
    raise exception 'This account already belongs to an organization';
  end if;

  insert into public.organizations (name)
  values (trim(p_organization_name))
  returning id into v_organization_id;

  v_clinic_id := public._provision_new_clinic(p_branch_name, p_owner_email, v_organization_id);

  insert into public.clinic_users (
    clinic_id, full_name, email, phone, role, status, auth_user_id
  )
  values (
    v_clinic_id, p_owner_full_name, p_owner_email, p_owner_phone,
    'Owner', 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  insert into public.organization_users (
    organization_id, auth_user_id, role, active_clinic_id
  )
  values (
    v_organization_id, v_uid, 'CEO', v_clinic_id
  );

  return query select v_organization_id, v_clinic_id, v_clinic_user_id;
end;
$$;

grant execute on function public.create_organization_with_ceo(text, text, text, text, text) to authenticated;

-- ============================================================
-- 9. create_branch - CEO-only. Unlike create_organization_with_ceo,
--    the caller is EXPECTED to already have clinic_users rows (their
--    existing branches), so there is no "already linked" guard here -
--    only "is this caller actually the CEO of an organization". Full
--    name/email are pulled from the caller's own existing clinic_users
--    row rather than being duplicated onto organization_users, so
--    there's exactly one place that data can go stale.
-- ============================================================

create or replace function public.create_branch(p_branch_name text)
returns table (clinic_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_role text;
  v_full_name text;
  v_email text;
  v_clinic_id uuid;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_branch_name is null or length(trim(p_branch_name)) = 0 then
    raise exception 'Branch name is required';
  end if;

  select organization_id, role into v_organization_id, v_role
  from public.organization_users
  where auth_user_id = v_uid;

  if v_organization_id is null then
    raise exception 'Not a member of any organization';
  end if;

  if v_role <> 'CEO' then
    raise exception 'Only the organization CEO can create a new branch';
  end if;

  select full_name, email into v_full_name, v_email
  from public.clinic_users
  where auth_user_id = v_uid
  order by created_at asc
  limit 1;

  v_clinic_id := public._provision_new_clinic(p_branch_name, v_email, v_organization_id);

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id
  )
  values (
    v_clinic_id, v_full_name, v_email, 'Owner', 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  return query select v_clinic_id;
end;
$$;

grant execute on function public.create_branch(text) to authenticated;

-- ============================================================
-- 10. switch_active_branch - a pure UX convenience, never a security
--     boundary (RLS on every clinic-scoped table is what actually gates
--     access - see the migration header). Requires the caller to
--     already hold a real clinic_users row for the target branch, so it
--     can never be used to "select into" a branch the caller doesn't
--     already have legitimate access to.
-- ============================================================

create or replace function public.switch_active_branch(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.organization_users where auth_user_id = v_uid
  ) then
    raise exception 'Not a member of any organization';
  end if;

  if not exists (
    select 1 from public.clinic_users
    where auth_user_id = v_uid and clinic_id = p_clinic_id
  ) then
    raise exception 'You do not have access to this branch';
  end if;

  update public.organization_users
  set active_clinic_id = p_clinic_id
  where auth_user_id = v_uid;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;

-- ============================================================
-- 11. get_organization_invitation_details - a SEPARATE, distinctly-named
--     function from get_invitation_details (migration 0008), not a
--     CREATE OR REPLACE of it. Postgres refuses to change an existing
--     function's return-column set via CREATE OR REPLACE ("cannot
--     change return type of existing function") - confirmed live: an
--     earlier version of this migration tried exactly that (adding
--     organization_name to get_invitation_details's TABLE(...) shape)
--     and failed to apply. Changing it would also have meant DROP +
--     CREATE to force the type change, which was never acceptable here
--     regardless - get_invitation_details is the existing
--     independent-clinic invitation RPC and must stay untouched: same
--     name, same arguments, same return columns, same behavior.
--
--     INNER JOIN to organizations (not LEFT JOIN) is deliberate: this
--     function returns a row ONLY for a branch invitation (clinic.
--     organization_id is not null) and zero rows for an ordinary
--     independent-clinic invitation. That's the signal
--     services/staffInvitations.ts#acceptInvitation uses to decide
--     which accept RPC applies - try this function first, and only fall
--     back to the original get_invitation_details when it finds nothing.
-- ============================================================

create or replace function public.get_organization_invitation_details(p_token text)
returns table (
  email text,
  role text,
  full_name text,
  clinic_name text,
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
  select si.email, si.role, si.full_name, c.name, o.name, si.expires_at, si.accepted_at
  from public.staff_invitations si
  join public.clinics c on c.id = si.clinic_id
  join public.organizations o on o.id = c.organization_id
  where si.token = p_token;
end;
$$;

grant execute on function public.get_organization_invitation_details(text) to anon, authenticated;

-- ============================================================
-- 12. create_branch_invitation - deliberately a SEPARATE function from
--     create_staff_invitation (not a shared/branching body) so the
--     independent-clinic invitation path is provably untouched by this
--     migration. Reuses is_clinic_owner_or_admin as-is for
--     authorization (a CEO who is 'Owner' of the target branch already
--     satisfies it - no new per-branch authorization helper needed).
--     Guarded to organization-linked clinics only, so this RPC can never
--     be pointed at an independent clinic to bypass
--     create_staff_invitation's stricter single-clinic-per-person rule.
--     The "already staff somewhere else" restriction from
--     create_staff_invitation is deliberately NOT carried over here -
--     scoped to "already staff of THIS branch" only, so an existing
--     organization member can be invited to an additional branch.
-- ============================================================

create or replace function public.create_branch_invitation(
  p_clinic_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_token text
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_clinic_user_id uuid;
  v_organization_id uuid;
  v_email text := lower(trim(p_email));
  v_invitation_id uuid;
  v_expires_at timestamptz;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select organization_id into v_organization_id
  from public.clinics
  where id = p_clinic_id;

  if v_organization_id is null then
    raise exception 'This clinic is not part of an organization';
  end if;

  if not public.is_clinic_owner_or_admin(p_clinic_id) then
    raise exception 'Only this branch''s owners and admins can invite staff';
  end if;

  select id into v_caller_clinic_user_id
  from public.clinic_users
  where auth_user_id = v_uid and clinic_id = p_clinic_id;

  if p_role not in ('Admin', 'Dentist', 'Receptionist') then
    raise exception 'Invalid role';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please provide a valid email address';
  end if;

  if exists (
    select 1 from public.clinic_users
    where clinic_id = p_clinic_id and lower(email) = v_email
  ) then
    raise exception 'This person is already a staff member of this branch';
  end if;

  delete from public.staff_invitations
  where clinic_id = p_clinic_id
    and lower(email) = v_email
    and accepted_at is null
    and staff_invitations.expires_at < now();

  if exists (
    select 1 from public.staff_invitations
    where clinic_id = p_clinic_id
      and lower(email) = v_email
      and accepted_at is null
  ) then
    raise exception 'An invitation is already pending for this email';
  end if;

  v_expires_at := now() + interval '7 days';

  insert into public.staff_invitations (
    clinic_id, email, full_name, role, token, invited_by, expires_at
  )
  values (
    p_clinic_id, v_email, trim(p_full_name), p_role, p_token,
    v_caller_clinic_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_branch_invitation(uuid, text, text, text, text) to authenticated;

-- ============================================================
-- 13. accept_branch_invitation - deliberately separate from
--     accept_staff_invitation for the same isolation reason as above.
--     The critical divergence: guards on "already staff of THIS
--     branch" (not "already linked to a clinic" globally), so an
--     existing organization member accepting their second/third branch
--     invitation succeeds instead of being rejected. Atomically
--     establishes clinic_users AND organization_users together - a
--     caller can never observe a state with one but not the other.
--     Explicitly rejects a cross-organization accept attempt (an
--     account already in Organization X can't also join Organization Y,
--     preserving the one-organization-per-person invariant) rather than
--     silently corrupting or ignoring it.
-- ============================================================

create or replace function public.accept_branch_invitation(p_token text)
returns table (
  organization_id uuid, clinic_id uuid, clinic_user_id uuid, role text, full_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_email text;
  v_invitation record;
  v_organization_id uuid;
  v_clinic_user_id uuid;
  v_existing_org_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invitation
  from public.staff_invitations
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

  select organization_id into v_organization_id
  from public.clinics
  where id = v_invitation.clinic_id;

  if v_organization_id is null then
    raise exception 'This invitation is not a branch invitation';
  end if;

  if exists (
    select 1 from public.clinic_users
    where auth_user_id = v_uid and clinic_id = v_invitation.clinic_id
  ) then
    raise exception 'You already have access to this branch';
  end if;

  select organization_id into v_existing_org_id
  from public.organization_users
  where auth_user_id = v_uid;

  if v_existing_org_id is not null and v_existing_org_id <> v_organization_id then
    raise exception 'This account already belongs to a different organization';
  end if;

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id
  )
  values (
    v_invitation.clinic_id, v_invitation.full_name, v_invitation.email,
    v_invitation.role, 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  if v_existing_org_id is null then
    insert into public.organization_users (
      organization_id, auth_user_id, role, active_clinic_id
    )
    values (
      v_organization_id, v_uid, 'Member', v_invitation.clinic_id
    );
  else
    -- Already an organization member (e.g. accepting a second/third
    -- branch) - never downgrade an existing CEO to Member, and only
    -- default active_clinic_id to the new branch if nothing was
    -- selected yet, so accepting a second branch doesn't silently
    -- switch a CEO/Member away from whatever branch they're currently
    -- looking at.
    update public.organization_users
    set active_clinic_id = coalesce(active_clinic_id, v_invitation.clinic_id)
    where auth_user_id = v_uid;
  end if;

  update public.staff_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return query select
    v_organization_id, v_invitation.clinic_id, v_clinic_user_id, v_invitation.role, v_invitation.full_name;
end;
$$;

grant execute on function public.accept_branch_invitation(text) to authenticated;
