-- Branch invitation role options: Dentist and Receptionist.
--
-- GOAL: a CEO inviting someone into a branch should be able to assign them
-- exactly the same Dentist/Receptionist permissions an independent clinic
-- already grants through its own staff setup - no second permission list,
-- no new wildcard/Admin grant.
--
-- CANONICAL SOURCE OF TRUTH (unchanged by this migration):
--   lib/permissions.ts - UserRole ('Owner'|'Admin'|'Dentist'|'Receptionist'),
--   the `permissions` record, and canAccess(). Every permission check in the
--   app (usePermissions -> canAccess) resolves off profile.role, which is
--   read straight from clinic_users.role (contexts/AuthContext.tsx). This
--   migration never touches lib/permissions.ts and never adds a second
--   permission table - it only changes which *organization*-level roles are
--   allowed, and how they map onto the existing clinic_users.role vocabulary
--   that lib/permissions.ts already governs.
--
-- ROOT FINDING (why this needed a code change, not just a UI dropdown edit):
--   organization_users/organization_invitations.role is a SEPARATE enum
--   (CEO/Partner/Manager/Viewer, migration 0014/0016) from clinic_users.role
--   (Owner/Admin/Dentist/Receptionist, migration 0008). An org-invited
--   Partner/Manager only gets real branch access lazily, the first time they
--   switch into a branch: switch_active_branch (0040) then inserts a
--   clinic_users row for that branch. That function HARD-CODES
--   `v_new_role := 'Admin'` for every organization role that reaches it
--   (Viewer is blocked earlier, CEO doesn't normally reach this path) -
--   there was previously no way to end up with anything other than full
--   clinic Admin (wildcard "*") permissions via a branch invitation.
--
-- FIX (smallest correct change, reusing the existing architecture):
--   1. Allow 'Dentist'/'Receptionist' as organization_users/
--      organization_invitations role values, alongside the existing
--      Partner/Manager/Viewer - CEO is still never invitable (unchanged).
--   2. create_organization_invitation / update_organization_member: extend
--      the existing p_role allow-list. Both already require the caller to
--      be the organization's CEO (is_organization_ceo check, unchanged) -
--      this is the existing, unmodified server-side authorization boundary
--      that decides who may invite/edit any role, including these two new
--      ones. The role value sent by the browser was never trusted on its
--      own before, and still isn't now.
--   3. switch_active_branch: when the organization member's role is
--      'Dentist' or 'Receptionist', the newly-provisioned clinic_users row
--      now gets that EXACT role instead of the hard-coded 'Admin' - so
--      lib/permissions.ts resolves the identical permission set an
--      independent clinic's own Dentist/Receptionist gets, automatically,
--      with zero duplication. CEO/Partner/Manager behavior is completely
--      unchanged (still maps to 'Admin', exactly as before) - existing
--      memberships and existing roles are untouched, this only changes what
--      happens for a role value that could not previously exist.
--
-- BRANCH SCOPE: unchanged. organization_user_branches/branch_access already
-- scope exactly which clinic(s) an org member (any role) can switch into -
-- switch_active_branch already re-checks this before ever reaching the role
-- mapping above, so a Dentist/Receptionist branch invitation is restricted
-- to its assigned branch(es) via the same, already-existing mechanism used
-- for every other organization role. Nothing new was built for this.
--
-- DATABASE: no new tables. clinic_users.role's check constraint already
-- includes 'Dentist'/'Receptionist' (migration 0008) - only the
-- organization-level enums needed widening.
--
-- Existing invitations/memberships are untouched - this only changes what a
-- NEW invitation can be created with and how a NEW branch membership is
-- provisioned on first switch.
--
-- Safe to re-run: constraint drop+recreate and create-or-replace only.

-- ============================================================
-- 1. Widen organization_users.role / organization_invitations.role
-- ============================================================

alter table public.organization_users drop constraint if exists organization_users_role_check;
alter table public.organization_users
  add constraint organization_users_role_check
  check (role in ('CEO', 'Partner', 'Manager', 'Viewer', 'Dentist', 'Receptionist'));

alter table public.organization_invitations drop constraint if exists organization_invitations_role_check;
alter table public.organization_invitations
  add constraint organization_invitations_role_check
  check (role in ('Partner', 'Manager', 'Viewer', 'Dentist', 'Receptionist'));

-- ============================================================
-- 2. create_organization_invitation - extend the role allow-list only.
--    Body otherwise byte-for-byte identical to 0038 (same signature, no
--    drop needed).
-- ============================================================

create or replace function public.create_organization_invitation(
  p_email text,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[],
  p_token text,
  p_full_name text default null,
  p_message text default null
)
returns table (invitation_id uuid, token text, expires_at timestamptz, invited_by_name text)
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

  if p_role not in ('Partner', 'Manager', 'Viewer', 'Dentist', 'Receptionist') then
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

  return query select v_invitation_id, p_token, v_expires_at, v_caller_full_name;
end;
$$;

grant execute on function public.create_organization_invitation(text, text, text, uuid[], text, text, text)
  to authenticated;

-- ============================================================
-- 3. update_organization_member - extend the role allow-list only. Body
--    otherwise byte-for-byte identical to 0036 (same signature, no drop
--    needed).
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

  if p_role not in ('Partner', 'Manager', 'Viewer', 'Dentist', 'Receptionist') then
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

-- ============================================================
-- 4. switch_active_branch - the actual permission fix. Everything is
--    byte-for-byte identical to 0040 except v_new_role, which now maps
--    Dentist/Receptionist through unchanged instead of collapsing every
--    organization role into 'Admin'. CEO/Partner/Manager keep the exact
--    same 'Admin' outcome they've always had - zero behavior change for
--    any existing member of any existing branch.
-- ============================================================

create or replace function public.switch_active_branch(p_clinic_id uuid)
returns table (clinic_id uuid, clinic_user_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
  v_org_user record;
  v_identity record;
  v_clinic_org_id uuid;
  v_new_role text;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.* into v_existing
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

  if found then
    return query select v_existing.clinic_id, v_existing.id, v_existing.role;
    return;
  end if;

  select * into v_org_user
  from public.organization_users
  where user_id = v_uid and status = 'Active';

  if v_org_user.id is null then
    raise exception 'You do not have access to this branch';
  end if;

  if v_org_user.role = 'Viewer' then
    raise exception 'Viewers do not have access to individual branch operations';
  end if;

  select c.organization_id into v_clinic_org_id
  from public.clinics c
  where c.id = p_clinic_id;

  if v_clinic_org_id is null or v_clinic_org_id <> v_org_user.organization_id then
    raise exception 'You do not have access to this branch';
  end if;

  if v_org_user.branch_access = 'selected' and not exists (
    select 1 from public.organization_user_branches oub
    where oub.organization_user_id = v_org_user.id and oub.clinic_id = p_clinic_id
  ) then
    raise exception 'You do not have access to this branch';
  end if;

  -- Dentist/Receptionist keep their exact canonical clinic_users.role (and
  -- therefore the exact lib/permissions.ts permission set an independent
  -- clinic's own Dentist/Receptionist gets) - every other organization role
  -- (CEO/Partner/Manager) keeps the original, unchanged 'Admin' outcome.
  v_new_role := case v_org_user.role
    when 'Dentist' then 'Dentist'
    when 'Receptionist' then 'Receptionist'
    else 'Admin'
  end;

  select * into v_identity from public.resolve_organization_user_identity(v_uid);

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id, organization_user_id
  )
  values (
    p_clinic_id, v_identity.full_name, v_identity.email, v_new_role, 'Active',
    v_uid, v_org_user.id
  )
  on conflict (auth_user_id, clinic_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    select cu.id into v_new_id
    from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;
  end if;

  return query select p_clinic_id, v_new_id, v_new_role;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;
