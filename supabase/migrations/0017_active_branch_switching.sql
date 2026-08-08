-- DentalFlow Enterprise, Phase 5: active branch context and switching.
--
-- This is the migration that relaxes the single most load-bearing
-- assumption in the whole schema: clinic_users has always had at most one
-- row per auth user (enforced only by the client's own
-- getCurrentClinicUser()#maybeSingle() throwing if that were ever
-- violated - never a real DB constraint). Organization members switching
-- into branches they don't personally own now need MULTIPLE clinic_users
-- rows, one per branch they've actually entered - so the invariant
-- becomes "at most one row per (auth_user_id, clinic_id) pair," which is
-- both safe (every existing user trivially satisfies it today) and
-- finally a real, enforced constraint rather than an assumption.
--
-- Every table/RLS policy elsewhere in this schema keeps working
-- completely unchanged, because an organization member who switches into
-- a branch gets a REAL clinic_users row for it (lazily created by
-- switch_active_branch below) - the existing
-- `exists(select 1 from clinic_users cu where cu.auth_user_id = auth.uid()
-- and cu.clinic_id = <table>.clinic_id)` pattern, used across ~24+ tables,
-- is satisfied by construction. This migration does NOT touch any of
-- those policies.
--
-- Safe to re-run: idempotent throughout (add column/constraint if not
-- exists, drop policy/function if exists + create), matching every other
-- migration in this folder.

-- ============================================================
-- 1. clinic_users: tag + real uniqueness constraint
--
--    organization_user_id is null for real hired staff, set for rows
--    lazily provisioned by switch_active_branch below - lets local staff-
--    management policies (section 6) and any future revocation logic
--    distinguish the two without guessing.
-- ============================================================

alter table public.clinic_users
  add column if not exists organization_user_id uuid
    references public.organization_users(id) on delete set null;

alter table public.clinic_users
  drop constraint if exists clinic_users_auth_user_clinic_unique;
alter table public.clinic_users
  add constraint clinic_users_auth_user_clinic_unique unique (auth_user_id, clinic_id);

-- ============================================================
-- 2. clinics_select_own - widened so an organization member can see a
--    branch's name/existence BEFORE they have a clinic_users row there
--    (needed to render a branch list to switch into at all). Purely
--    additive: the original clinic_users clause is untouched, and the new
--    clause only ever matches rows where organization_id is not null, so
--    independent clinics (organization_id always null) are completely
--    unaffected.
-- ============================================================

drop policy if exists "clinics_select_own" on public.clinics;
create policy "clinics_select_own"
  on public.clinics for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinics.id
    )
    or (
      clinics.organization_id is not null
      and exists (
        select 1 from public.organization_users ou
        where ou.user_id = auth.uid()
          and ou.organization_id = clinics.organization_id
          and ou.status = 'Active'
          and (
            ou.branch_access = 'all'
            or exists (
              select 1 from public.organization_user_branches oub
              where oub.organization_user_id = ou.id
                and oub.clinic_id = clinics.id
            )
          )
      )
    )
  );

-- ============================================================
-- 3. create_clinic_with_admin - the "already linked to a clinic" guard
--    was correct for one-clinic-per-signup (independent clinics) but now
--    incorrectly blocks a CEO from ever creating a SECOND branch once
--    they have any lazily-provisioned clinic_users row anywhere (from
--    switch_active_branch, section 5). When p_organization_id is
--    provided, authorization is is_organization_ceo(p_organization_id)
--    alone - the independent-clinic path (p_organization_id null) is
--    completely unchanged.
-- ============================================================

drop function if exists public.create_clinic_with_admin(text, text, text, text, uuid);

create or replace function public.create_clinic_with_admin(
  p_clinic_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null,
  p_organization_id uuid default null
)
returns table (clinic_id uuid, clinic_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_clinic_name is null or length(trim(p_clinic_name)) = 0 then
    raise exception 'Clinic name is required';
  end if;

  if p_organization_id is not null then
    if not public.is_organization_ceo(p_organization_id) then
      raise exception 'Only the organization''s CEO can create a branch for it';
    end if;
  else
    if exists (select 1 from public.clinic_users where auth_user_id = v_uid) then
      raise exception 'This account is already linked to a clinic';
    end if;
  end if;

  insert into public.clinics (name, email, plan, organization_id)
  values (trim(p_clinic_name), p_owner_email, 'free', p_organization_id)
  returning id into v_clinic_id;

  insert into public.clinic_settings (clinic_id, clinic_name, email)
  values (v_clinic_id, trim(p_clinic_name), p_owner_email);

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

  insert into public.clinic_users (
    clinic_id, full_name, email, phone, role, status, auth_user_id
  )
  values (
    v_clinic_id, p_owner_full_name, p_owner_email, p_owner_phone,
    'Owner', 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  return query select v_clinic_id, v_clinic_user_id;
end;
$$;

grant execute on function public.create_clinic_with_admin(text, text, text, text, uuid)
  to authenticated;

-- ============================================================
-- 4. create_staff_invitation / resend_staff_invitation - both used to
--    derive "the caller's clinic" via a bare `select ... into ... from
--    clinic_users where auth_user_id = v_uid` with no cardinality guard.
--    In plpgsql that does NOT error on multiple matching rows - it
--    silently keeps the last one processed (undefined order). Now that a
--    caller can have several clinic_users rows, that's a live correctness
--    bug, not a crash. Fixed by taking the caller's active clinic as an
--    explicit p_clinic_id parameter (services/staffInvitations.ts passes
--    getCurrentClinicId()) and using the already-correct, explicitly-
--    parameterized is_clinic_owner_or_admin(p_clinic_id) helper instead of
--    an implicit single-row derivation.
-- ============================================================

drop function if exists public.create_staff_invitation(text, text, text, text);

create or replace function public.create_staff_invitation(
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

  if not public.is_clinic_owner_or_admin(p_clinic_id) then
    raise exception 'Only clinic owners and admins can invite staff';
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
    raise exception 'This person is already a staff member of this clinic';
  end if;

  if exists (
    select 1 from public.clinic_users where lower(email) = v_email
  ) then
    raise exception 'This email already belongs to a staff member at another clinic';
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

grant execute on function public.create_staff_invitation(uuid, text, text, text, text)
  to authenticated;

drop function if exists public.resend_staff_invitation(uuid, text);

create or replace function public.resend_staff_invitation(
  p_clinic_id uuid,
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
  v_invitation_clinic_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  if not public.is_clinic_owner_or_admin(p_clinic_id) then
    raise exception 'Only clinic owners and admins can resend invitations';
  end if;

  select clinic_id into v_invitation_clinic_id
  from public.staff_invitations
  where id = p_invitation_id;

  if v_invitation_clinic_id is null or v_invitation_clinic_id <> p_clinic_id then
    raise exception 'Invitation not found';
  end if;

  v_expires_at := now() + interval '7 days';

  update public.staff_invitations
  set token = p_token, expires_at = v_expires_at
  where id = p_invitation_id and accepted_at is null;

  if not found then
    raise exception 'This invitation has already been accepted';
  end if;

  return query select p_token, v_expires_at;
end;
$$;

grant execute on function public.resend_staff_invitation(uuid, uuid, text) to authenticated;

-- ============================================================
-- 5. switch_active_branch - the only way a lazily-provisioned
--    clinic_users row is created. If the caller already has a real row
--    for this branch (hired staff, or a previous switch), returns it
--    as-is. Otherwise verifies organization membership, that the branch
--    belongs to the caller's OWN organization, and branch_access (all, or
--    an explicit organization_user_branches match) - then provisions.
--
--    Viewers are deliberately rejected, not mapped to any clinic role:
--    there is no read-only clinic_users role in this schema (Owner/Admin/
--    Dentist/Receptionist are all either full-access or narrowly
--    clinical), and building one now would mean auditing every
--    hasPermission() call site across the app. A Viewer's entire purpose
--    is aggregate/executive visibility (Organization Overview), not
--    individual branch operations.
--
--    CEO/Partner/Manager all provision as 'Admin' - a documented
--    simplification, no granular per-org-role clinic permission tiers
--    yet.
--
--    KNOWN, DELIBERATELY DEFERRED GAP: removing an organization member
--    (organization_users.status = 'Removed') does not revoke any
--    clinic_users rows already provisioned for them here - they keep
--    branch-level access until a future phase adds real revocation. Do
--    not assume "removed from the organization" means "removed from
--    every branch" yet.
--
--    Race-safety: two concurrent switches to the same not-yet-provisioned
--    branch both pass the "already exists" check under READ COMMITTED,
--    then race on insert - `on conflict ... do nothing returning id`
--    plus a re-select handles the loser gracefully instead of surfacing a
--    raw unique-violation error.
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
  v_clinic_org_id uuid;
  v_new_role text;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_existing
  from public.clinic_users
  where auth_user_id = v_uid and clinic_id = p_clinic_id;

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

  select organization_id into v_clinic_org_id
  from public.clinics
  where id = p_clinic_id;

  if v_clinic_org_id is null or v_clinic_org_id <> v_org_user.organization_id then
    raise exception 'You do not have access to this branch';
  end if;

  if v_org_user.branch_access = 'selected' and not exists (
    select 1 from public.organization_user_branches
    where organization_user_id = v_org_user.id and clinic_id = p_clinic_id
  ) then
    raise exception 'You do not have access to this branch';
  end if;

  v_new_role := 'Admin';

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id, organization_user_id
  )
  values (
    p_clinic_id, v_org_user.full_name, v_org_user.email, v_new_role, 'Active',
    v_uid, v_org_user.id
  )
  on conflict (auth_user_id, clinic_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Lost the race to a concurrent switch - the winning row already
    -- exists, just return it.
    select id into v_new_id
    from public.clinic_users
    where auth_user_id = v_uid and clinic_id = p_clinic_id;
  end if;

  return query select p_clinic_id, v_new_id, v_new_role;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;

-- ============================================================
-- 6. Protect lazily-provisioned rows from ordinary local staff
--    management - a branch's own local Admin should not be able to
--    strip a CEO/Partner/Manager's organization-granted access through
--    the ordinary Staff page. Same shape as the existing role <> 'Owner'
--    exclusion (0008), extended with organization_user_id is null.
-- ============================================================

drop policy if exists "clinic_users_update_staff_management" on public.clinic_users;
create policy "clinic_users_update_staff_management"
  on public.clinic_users for update
  using (
    clinic_users.role <> 'Owner'
    and clinic_users.organization_user_id is null
    and public.is_clinic_owner_or_admin(clinic_users.clinic_id)
  )
  with check (
    role <> 'Owner'
    and organization_user_id is null
    and public.is_clinic_owner_or_admin(clinic_id)
  );

drop policy if exists "clinic_users_delete_staff_management" on public.clinic_users;
create policy "clinic_users_delete_staff_management"
  on public.clinic_users for delete
  using (
    clinic_users.role <> 'Owner'
    and clinic_users.organization_user_id is null
    and public.is_clinic_owner_or_admin(clinic_users.clinic_id)
  );
