-- Phase 7 completion pass: branch filter for the roster, a real branch-
-- access-removal cascade for update_organization_member (the same class of
-- gap suspend/remove already closed, but for plain edits), invitation
-- full_name/message fields, and a proper pending-invitations RPC (was a
-- plain client select, couldn't resolve inviter names without one).
--
-- Schema check before writing this (per the now-established "never assume"
-- rule): organization_invitations' real columns were confirmed via the
-- same live-introspection method as 0034/0035 - id, organization_id,
-- email, role, branch_access, token, invited_by, accepted_at, expires_at,
-- created_at. full_name/message genuinely do not exist yet; adding them
-- here is a fresh, additive, nullable column (not a duplicate of anything
-- - organization_users has no full_name and never will per the earlier
-- fix, and this is a different table/purpose: an optional INVITER-supplied
-- hint, not the invitee's authoritative name, which is still supplied by
-- the invitee at accept time per 0016's original design - unchanged).
--
-- Every new/changed function here was written qualifying every table
-- column against its alias from the start (ou./cu./oi./al./c. etc.),
-- specifically to avoid repeating the clinic_id/full_name/email/role
-- ambiguity-and-missing-column bugs already hit twice in this feature.
--
-- Signature changes use `drop function if exists` before `create or
-- replace` (matching 0029's create_clinic_with_admin precedent) -
-- `create or replace` only replaces a function whose argument TYPE LIST is
-- identical; adding a parameter (even with a default) is a different
-- signature and would otherwise silently create a second overload instead
-- of replacing the old one.
--
-- Safe to re-run: every statement is idempotent.

-- ============================================================
-- 1. organization_invitations - full_name (inviter's hint, invitee still
--    confirms/can override at accept time - not authoritative) and message
--    (optional personal note, shown on the accept page).
-- ============================================================

alter table public.organization_invitations
  add column if not exists full_name text;

alter table public.organization_invitations
  add column if not exists message text;

-- ============================================================
-- 2. create_organization_invitation - now accepts p_full_name (required)
--    and p_message (optional), stores both. New params appended at the
--    end with defaults so existing behavior for anything that omits them
--    is unaffected; the client is updated alongside this migration to
--    always pass p_full_name.
-- ============================================================

drop function if exists public.create_organization_invitation(text, text, text, uuid[], text);

create or replace function public.create_organization_invitation(
  p_email text,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[],
  p_token text,
  p_full_name text default null,
  p_message text default null
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
  v_caller_full_name text;
  v_caller_email text;
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

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  select organization_id, id into v_caller_org_id, v_caller_org_user_id
  from public.organization_users
  where user_id = v_uid and status = 'Active' and role = 'CEO';

  if v_caller_org_id is null then
    raise exception 'Only the organization''s CEO can invite members';
  end if;

  select full_name, email into v_caller_full_name, v_caller_email
  from public.resolve_organization_user_identity(v_uid);

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
    select 1
    from public.organization_users ou2
    join auth.users u on u.id = ou2.user_id
    where ou2.organization_id = v_caller_org_id and lower(u.email) = v_email
  ) then
    raise exception 'This person is already a member of this organization';
  end if;

  if exists (
    select 1
    from public.organization_users ou2
    join auth.users u on u.id = ou2.user_id
    where lower(u.email) = v_email
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
    organization_id, email, full_name, message, role, branch_access, token, invited_by, expires_at
  )
  values (
    v_caller_org_id, v_email, trim(p_full_name), nullif(trim(coalesce(p_message, '')), ''),
    p_role, p_branch_access, p_token, v_caller_org_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  if p_branch_access = 'selected' then
    foreach v_branch_id in array p_branch_ids loop
      insert into public.organization_invitation_branches (invitation_id, clinic_id)
      values (v_invitation_id, v_branch_id);
    end loop;
  end if;

  perform public.log_organization_audit_event(
    v_caller_org_id, v_caller_org_user_id, v_caller_full_name, v_caller_email,
    'member_invited', 'invitation', v_invitation_id, trim(p_full_name), v_email,
    null, null, jsonb_build_object('role', p_role, 'branch_access', p_branch_access), null
  );

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_organization_invitation(text, text, text, uuid[], text, text, text)
  to authenticated;

-- ============================================================
-- 3. get_organization_invitation_details - now also returns full_name and
--    message so the accept page can prefill the name and show the note.
--    Return type is changing (2 new columns), so this also needs a drop
--    first.
-- ============================================================

drop function if exists public.get_organization_invitation_details(text);

create or replace function public.get_organization_invitation_details(p_token text)
returns table (
  email text,
  role text,
  branch_access text,
  organization_name text,
  expires_at timestamptz,
  accepted_at timestamptz,
  full_name text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select oi.email, oi.role, oi.branch_access, o.name, oi.expires_at, oi.accepted_at,
         oi.full_name, oi.message
  from public.organization_invitations oi
  join public.organizations o on o.id = oi.organization_id
  where oi.token = p_token;
end;
$$;

grant execute on function public.get_organization_invitation_details(text) to anon, authenticated;

-- ============================================================
-- 4. get_organization_pending_invitations - replaces the plain client
--    `.from("organization_invitations").select(...)` (services/
--    organizationInvitations.ts#getPendingOrganizationInvitations) so the
--    inviter's name (organization_invitations.invited_by -> organization_
--    users.id -> resolve_organization_user_identity) and each invitation's
--    branch names can be resolved server-side instead of N+1 client calls.
-- ============================================================

create or replace function public.get_organization_pending_invitations(p_organization_id uuid)
returns table (
  id uuid,
  email text,
  full_name text,
  message text,
  role text,
  branch_access text,
  branch_names text[],
  token text,
  invited_by_name text,
  expires_at timestamptz,
  created_at timestamptz,
  is_expired boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_organization_ceo(p_organization_id) then
    raise exception 'Only the organization''s CEO can view pending invitations';
  end if;

  return query
  select
    oi.id,
    oi.email,
    oi.full_name,
    oi.message,
    oi.role,
    oi.branch_access,
    case
      when oi.branch_access = 'all' then
        (select coalesce(array_agg(c.name order by c.name), array[]::text[])
         from public.clinics c where c.organization_id = p_organization_id)
      else
        (select coalesce(array_agg(c.name order by c.name), array[]::text[])
         from public.organization_invitation_branches oib
         join public.clinics c on c.id = oib.clinic_id
         where oib.invitation_id = oi.id)
    end as branch_names,
    oi.token,
    nullif(inviter_ident.full_name, '') as invited_by_name,
    oi.expires_at,
    oi.created_at,
    (oi.expires_at < now()) as is_expired
  from public.organization_invitations oi
  left join public.organization_users inviter on inviter.id = oi.invited_by
  left join lateral public.resolve_organization_user_identity(inviter.user_id) as inviter_ident on true
  where oi.organization_id = p_organization_id
    and oi.accepted_at is null
  order by oi.created_at desc;
end;
$$;

grant execute on function public.get_organization_pending_invitations(uuid) to authenticated;

-- ============================================================
-- 5. get_organization_team_roster - add p_branch_id filter ("Manager +
--    Westlands + Active" combined filtering). Signature change (new
--    parameter) needs a drop first.
-- ============================================================

drop function if exists public.get_organization_team_roster(uuid, text, text, text, int, int);

create or replace function public.get_organization_team_roster(
  p_organization_id uuid,
  p_search text default null,
  p_role text default null,
  p_status text default null,
  p_branch_id uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  member_key text,
  source text,
  organization_user_id uuid,
  clinic_user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  branch_scope text,
  branch_ids uuid[],
  branch_names text[],
  invited_by_name text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_organization_ceo(p_organization_id) then
    raise exception 'Only the organization''s CEO can view the team roster';
  end if;

  return query
  with org_rows as (
    select
      'org:' || ou.id as member_key,
      'organization'::text as source,
      ou.id as organization_user_id,
      null::uuid as clinic_user_id,
      ident.full_name,
      ident.email,
      ou.role,
      ou.status,
      ou.branch_access as branch_scope,
      case
        when ou.branch_access = 'all' then
          (select coalesce(array_agg(c.id order by c.name), array[]::uuid[])
           from public.clinics c where c.organization_id = p_organization_id)
        else
          (select coalesce(array_agg(c.id order by c.name), array[]::uuid[])
           from public.organization_user_branches oub
           join public.clinics c on c.id = oub.clinic_id
           where oub.organization_user_id = ou.id)
      end as branch_ids,
      case
        when ou.branch_access = 'all' then
          (select coalesce(array_agg(c.name order by c.name), array[]::text[])
           from public.clinics c where c.organization_id = p_organization_id)
        else
          (select coalesce(array_agg(c.name order by c.name), array[]::text[])
           from public.organization_user_branches oub
           join public.clinics c on c.id = oub.clinic_id
           where oub.organization_user_id = ou.id)
      end as branch_names,
      nullif(inviter_ident.full_name, '') as invited_by_name,
      ou.created_at
    from public.organization_users ou
    cross join lateral public.resolve_organization_user_identity(ou.user_id) as ident
    left join public.organization_users inviter on inviter.id = ou.invited_by
    left join lateral public.resolve_organization_user_identity(inviter.user_id) as inviter_ident on true
    where ou.organization_id = p_organization_id
  ),
  clinic_rows as (
    select
      'clinic:' || cu.id as member_key,
      'clinic'::text as source,
      null::uuid as organization_user_id,
      cu.id as clinic_user_id,
      cu.full_name,
      cu.email,
      cu.role,
      cu.status,
      'single'::text as branch_scope,
      array[cu.clinic_id]::uuid[] as branch_ids,
      array[c.name]::text[] as branch_names,
      null::text as invited_by_name,
      cu.created_at
    from public.clinic_users cu
    join public.clinics c on c.id = cu.clinic_id
    where c.organization_id = p_organization_id
      and cu.organization_user_id is null
  ),
  combined as (
    select * from org_rows
    union all
    select * from clinic_rows
  ),
  filtered as (
    select combined.*
    from combined
    where
      (p_role is null or combined.role = p_role)
      and (
        (p_status is not null and combined.status = p_status)
        or (p_status is null and combined.status <> 'Removed')
      )
      and (p_branch_id is null or p_branch_id = any (combined.branch_ids))
      and (
        p_search is null or length(trim(p_search)) = 0
        or combined.full_name ilike '%' || p_search || '%'
        or combined.email ilike '%' || p_search || '%'
        or exists (
          select 1 from unnest(combined.branch_names) bn where bn ilike '%' || p_search || '%'
        )
      )
  )
  select
    filtered.member_key,
    filtered.source,
    filtered.organization_user_id,
    filtered.clinic_user_id,
    filtered.full_name,
    filtered.email,
    filtered.role,
    filtered.status,
    filtered.branch_scope,
    filtered.branch_ids,
    filtered.branch_names,
    filtered.invited_by_name,
    filtered.created_at,
    count(*) over() as total_count
  from filtered
  order by filtered.full_name asc, filtered.email asc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.get_organization_team_roster(uuid, text, text, text, uuid, int, int)
  to authenticated;

-- ============================================================
-- 6. update_organization_member - branch-access-removal cascade. Editing
--    a member down to a smaller branch set (or from 'all' to 'selected')
--    previously only touched organization_user_branches - any clinic_users
--    row they'd already been lazily provisioned into for a now-removed
--    branch was left untouched, meaning they kept real operational access
--    to a branch they were no longer authorized for. Same fix shape as
--    suspend/remove's cascade (0034): hard-delete the lazily-provisioned
--    rows for exactly the branches being removed - genuine local hires are
--    never touched (organization_user_id is not null is implicit in the
--    delete's own foreign key scope). No RLS change needed.
-- ============================================================

create or replace function public.update_organization_member(
  p_organization_user_id uuid,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_actor record;
  v_target_identity record;
  v_actor_identity record;
  v_before_branch_ids uuid[];
  v_after_branch_ids uuid[];
  v_removed_branch_ids uuid[];
  v_before_names text[];
  v_after_names text[];
  v_branch_id uuid;
begin
  select * into v_target from public.organization_users where id = p_organization_user_id;

  if v_target.id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_organization_ceo(v_target.organization_id) then
    raise exception 'Only the organization''s CEO can edit a member';
  end if;

  if v_target.role = 'CEO' or p_role = 'CEO' then
    raise exception 'The CEO role cannot be changed through this function';
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

  if p_branch_access = 'selected' then
    if exists (
      select 1
      from unnest(p_branch_ids) as bid
      left join public.clinics c
        on c.id = bid and c.organization_id = v_target.organization_id
      where c.id is null
    ) then
      raise exception 'One or more selected branches are invalid';
    end if;
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_target.organization_id and status = 'Active';

  select * into v_target_identity from public.resolve_organization_user_identity(v_target.user_id);
  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  if v_target.branch_access = 'all' then
    select coalesce(array_agg(c.id), array[]::uuid[]) into v_before_branch_ids
    from public.clinics c where c.organization_id = v_target.organization_id;
  else
    select coalesce(array_agg(oub.clinic_id), array[]::uuid[]) into v_before_branch_ids
    from public.organization_user_branches oub
    where oub.organization_user_id = p_organization_user_id;
  end if;

  update public.organization_users
  set role = p_role, branch_access = p_branch_access, updated_at = now()
  where id = p_organization_user_id;

  if p_branch_access = 'all' then
    delete from public.organization_user_branches
    where organization_user_id = p_organization_user_id;

    select coalesce(array_agg(c.id), array[]::uuid[]) into v_after_branch_ids
    from public.clinics c where c.organization_id = v_target.organization_id;
  else
    foreach v_branch_id in array p_branch_ids loop
      insert into public.organization_user_branches (organization_user_id, clinic_id)
      values (p_organization_user_id, v_branch_id)
      on conflict (organization_user_id, clinic_id) do nothing;
    end loop;

    delete from public.organization_user_branches
    where organization_user_id = p_organization_user_id
      and clinic_id <> all (p_branch_ids);

    v_after_branch_ids := p_branch_ids;
  end if;

  select coalesce(array_agg(bid), array[]::uuid[]) into v_removed_branch_ids
  from unnest(v_before_branch_ids) as bid
  where bid <> all (v_after_branch_ids);

  if array_length(v_removed_branch_ids, 1) is not null then
    delete from public.clinic_users
    where organization_user_id = p_organization_user_id
      and clinic_id = any (v_removed_branch_ids);
  end if;

  if v_target.role <> p_role then
    perform public.log_organization_audit_event(
      v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
      'member_role_changed', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
      null, jsonb_build_object('role', v_target.role), jsonb_build_object('role', p_role), null
    );
  end if;

  if v_target.branch_access <> p_branch_access
     or not (
       v_before_branch_ids @> v_after_branch_ids
       and v_after_branch_ids @> v_before_branch_ids
     ) then

    select coalesce(array_agg(c.name order by c.name), array[]::text[]) into v_before_names
    from public.clinics c where c.id = any (v_before_branch_ids);

    select coalesce(array_agg(c.name order by c.name), array[]::text[]) into v_after_names
    from public.clinics c where c.id = any (v_after_branch_ids);

    perform public.log_organization_audit_event(
      v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
      'member_branches_changed', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
      null,
      jsonb_build_object('branch_access', v_target.branch_access, 'branches', to_jsonb(v_before_names)),
      jsonb_build_object('branch_access', p_branch_access, 'branches', to_jsonb(v_after_names)),
      null
    );
  end if;
end;
$$;

grant execute on function public.update_organization_member(uuid, text, text, uuid[]) to authenticated;
