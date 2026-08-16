-- ============================================================
-- FULL REMOVAL OF THE MULTI-BRANCH / ORGANIZATION FEATURE.
--
-- This is a deliberate, approved rollback (not a bug fix) - multi-branch
-- is being rebuilt from a clean foundation. It undoes everything
-- introduced by migrations 0014-0018, 0029-0040, 0046, 0047 (organizations,
-- organization_users, organization_invitations, organization_user_branches,
-- organization_invitation_branches, organization_audit_log, branch
-- switching, the organization dashboard/team/analytics RPCs, and the
-- temp-password invitation-provisioning flow), while explicitly preserving
-- every pre-existing, unrelated feature that happened to land in the same
-- source commits (procurement, insurance billing, treatment profitability,
-- inventory stock control, the accounting ledger, supplier accounts
-- payable, and the genuine pre-existing patients-table INSERT policy fix
-- from migration 0040, which stays untouched).
--
-- Old migrations 0014-0047 are left in the repo unedited (migrations are
-- never rewritten after the fact) - this file is the forward-only undo.
--
-- NO CASCADE ANYWHERE in this file. Every object is dropped in explicit
-- dependency order instead - see the audit that preceded this version for
-- the full object-by-object dependency map. In short: a first attempt at
-- this migration tried to drop clinics.organization_id before dropping
-- organization_user_branches, whose own organization_user_branches_
-- insert_ceo_only policy directly queries clinics.organization_id in its
-- WITH CHECK clause - Postgres correctly refused (error 2BP01). The fix is
-- ordering, not CASCADE: every org-exclusive TABLE (which removes its own
-- policies as an intrinsic, non-CASCADE part of being dropped) is removed
-- before the two organization-linkage COLUMNS on the pre-existing
-- clinics/clinic_users tables, which are in turn removed before the
-- organizations/organization_users tables those columns reference.
--
-- DATA IMPACT (confirmed against live data before writing this): 3
-- organizations, 3 organization_users, 2 organization_user_branches, 3
-- organization_invitations, 3 organization_invitation_branches, and 76
-- organization_audit_log rows exist and will be permanently deleted.
-- clinics.organization_id is ON DELETE SET NULL, so the 6 clinics
-- currently tagged with an organization_id are NOT deleted and keep every
-- bit of their own operational data (patients, appointments, invoices,
-- etc.) - they simply become standalone clinics again, exactly like every
-- other clinic in this system before this feature existed.
--
-- NOT restored (deliberately, per audit): clinic_users_email_key (dropped
-- in migration 0019). Live data has the same real email spanning 3
-- different clinic_users rows (a CEO's multi-branch account) - restoring
-- a global-uniqueness constraint would fail against that data outright.
-- The stricter, real per-(auth_user_id, clinic_id) uniqueness constraint
-- added in 0017 is being kept as-is, since it is strictly safer than the
-- pre-0017 state (an unenforced assumption) and reverting it would only
-- remove a real safety net for zero benefit.
-- ============================================================

-- ============================================================
-- 1. Restore the two pre-existing tables' RLS policies to their
--    pre-organization bodies, removing every reference to
--    organization_id/organization_user_id from policies that live ON
--    clinics/clinic_users themselves, before anything else.
-- ============================================================

-- clinics_select_own - back to migration 0001's body (widened in 0017 to
-- also match organization-linked branches; that clause is removed).
drop policy if exists "clinics_select_own" on public.clinics;
create policy "clinics_select_own"
  on public.clinics for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinics.id
    )
  );

-- clinics_update_admin_only - back to its 0010-hardened body (0014 added
-- an organization_id/is_organization_ceo gate on top; that clause is
-- removed, the base is_clinic_owner_or_admin check is unchanged).
drop policy if exists "clinics_update_admin_only" on public.clinics;
create policy "clinics_update_admin_only"
  on public.clinics for update
  using (public.is_clinic_owner_or_admin(clinics.id))
  with check (public.is_clinic_owner_or_admin(clinics.id));

-- clinic_users_update_staff_management / _delete_staff_management - back
-- to their 0008 body (0017 added an `organization_user_id is null`
-- clause on top; removed - every clinic_users row is real hired staff
-- again, there is no other kind).
drop policy if exists "clinic_users_update_staff_management" on public.clinic_users;
create policy "clinic_users_update_staff_management"
  on public.clinic_users for update
  using (
    clinic_users.role <> 'Owner'
    and public.is_clinic_owner_or_admin(clinic_users.clinic_id)
  )
  with check (
    role <> 'Owner'
    and public.is_clinic_owner_or_admin(clinic_id)
  );

drop policy if exists "clinic_users_delete_staff_management" on public.clinic_users;
create policy "clinic_users_delete_staff_management"
  on public.clinic_users for delete
  using (
    clinic_users.role <> 'Owner'
    and public.is_clinic_owner_or_admin(clinic_users.clinic_id)
  );

-- ============================================================
-- 2. Drop organization-exclusive TABLES, leaf-first, before touching any
--    column or the tables those columns reference. Dropping a table
--    removes its own RLS policies/indexes/constraints intrinsically -
--    that is not CASCADE, which only concerns EXTERNAL dependents (a
--    policy on another table, a foreign key from another table). Nothing
--    external is being overridden here: each drop below only proceeds
--    once every other table that could still reference it is already
--    gone.
--
--    organization_invitation_branches -> FKs to organization_invitations,
--      clinics: drop first, nothing references it.
--    organization_audit_log -> FKs to organizations, organization_users:
--      no other org table references it.
--    organization_invitations -> FKs to organizations, organization_users:
--      organization_invitation_branches (its only dependent) is already
--      gone.
--    organization_user_branches -> FKs to organization_users, clinics.
--      This is the table whose organization_user_branches_insert_ceo_only
--      policy directly queries clinics.organization_id - dropping the
--      table here, BEFORE step 3 touches that column, is what makes step
--      3 succeed without CASCADE.
-- ============================================================

drop table if exists public.organization_invitation_branches;
drop table if exists public.organization_audit_log;
drop table if exists public.organization_invitations;
drop table if exists public.organization_user_branches;

-- ============================================================
-- 3. Now safe to drop the two organization-linkage columns on the
--    pre-existing clinics/clinic_users tables - every policy that
--    referenced them (step 1) and every other-table policy that
--    referenced them (organization_user_branches_insert_ceo_only,
--    removed with its table in step 2) is gone. Their indexes and FK
--    constraints (to organizations/organization_users, both still about
--    to be dropped in step 5) go with them automatically - that is
--    intrinsic to dropping a column, not CASCADE.
-- ============================================================

alter table public.clinics drop column if exists organization_id;
alter table public.clinic_users drop column if exists organization_user_id;

-- ============================================================
-- 4. Restore the three pre-existing functions that were extended for
--    organization-awareness back to their pre-organization signatures and
--    bodies (migration 0008 originals). Signatures change (a parameter is
--    removed), so each needs an explicit drop of every current overload
--    first - not a dependency issue, just how CREATE OR REPLACE works
--    when the parameter list itself changes.
-- ============================================================

drop function if exists public.create_clinic_with_admin(text, text, text, text, uuid, uuid[]);
drop function if exists public.create_clinic_with_admin(text, text, text, text, uuid);
drop function if exists public.create_clinic_with_admin(text, text, text, text);

create or replace function public.create_clinic_with_admin(
  p_clinic_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null,
  p_insurance_provider_ids uuid[] default '{}'::uuid[]
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

  if exists (select 1 from public.clinic_users where auth_user_id = v_uid) then
    raise exception 'This account is already linked to a clinic';
  end if;

  insert into public.clinics (name, email, plan)
  values (trim(p_clinic_name), p_owner_email, 'free')
  returning id into v_clinic_id;

  if p_insurance_provider_ids is not null and array_length(p_insurance_provider_ids, 1) > 0 then
    insert into public.clinic_insurance_providers (clinic_id, insurance_provider_id)
    select v_clinic_id, pid
    from unnest(p_insurance_provider_ids) as pid
    where exists (
      select 1 from public.insurance_providers ip
      where ip.id = pid and ip.active
    )
    on conflict (clinic_id, insurance_provider_id) do nothing;
  end if;

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

grant execute on function public.create_clinic_with_admin(text, text, text, text, uuid[])
  to authenticated;

drop function if exists public.create_staff_invitation(uuid, text, text, text, text);
drop function if exists public.create_staff_invitation(text, text, text, text);

create or replace function public.create_staff_invitation(
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
  v_caller_clinic_id uuid;
  v_caller_clinic_user_id uuid;
  v_caller_role text;
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

  select clinic_id, id, role
    into v_caller_clinic_id, v_caller_clinic_user_id, v_caller_role
  from public.clinic_users
  where auth_user_id = v_uid;

  if v_caller_clinic_id is null then
    raise exception 'Not linked to a clinic';
  end if;

  if v_caller_role not in ('Owner', 'Admin') then
    raise exception 'Only clinic owners and admins can invite staff';
  end if;

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
    where clinic_id = v_caller_clinic_id and lower(email) = v_email
  ) then
    raise exception 'This person is already a staff member of this clinic';
  end if;

  if exists (
    select 1 from public.clinic_users where lower(email) = v_email
  ) then
    raise exception 'This email already belongs to a staff member at another clinic';
  end if;

  delete from public.staff_invitations
  where clinic_id = v_caller_clinic_id
    and lower(email) = v_email
    and accepted_at is null
    and staff_invitations.expires_at < now();

  if exists (
    select 1 from public.staff_invitations
    where clinic_id = v_caller_clinic_id
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
    v_caller_clinic_id, v_email, trim(p_full_name), p_role, p_token,
    v_caller_clinic_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_staff_invitation(text, text, text, text) to authenticated;

drop function if exists public.resend_staff_invitation(uuid, uuid, text);
drop function if exists public.resend_staff_invitation(uuid, text);

create or replace function public.resend_staff_invitation(
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
  v_caller_clinic_id uuid;
  v_caller_role text;
  v_invitation_clinic_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  select clinic_id, role into v_caller_clinic_id, v_caller_role
  from public.clinic_users
  where auth_user_id = v_uid;

  if v_caller_role not in ('Owner', 'Admin') then
    raise exception 'Only clinic owners and admins can resend invitations';
  end if;

  select clinic_id into v_invitation_clinic_id
  from public.staff_invitations
  where id = p_invitation_id;

  if v_invitation_clinic_id is null or v_invitation_clinic_id <> v_caller_clinic_id then
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

grant execute on function public.resend_staff_invitation(uuid, text) to authenticated;

-- ============================================================
-- 5. Drop the two remaining organization-exclusive tables. Safe now:
--    organization_users has no more dependents (organization_user_branches/
--    organization_invitations/organization_audit_log already gone in step
--    2, clinic_users.organization_user_id already gone in step 3).
--    organizations has no more dependents (organization_users about to go;
--    clinics.organization_id already gone in step 3).
-- ============================================================

drop table if exists public.organization_users;
drop table if exists public.organizations;

-- ============================================================
-- 6. Drop every organization-exclusive function, all overloads,
--    regardless of exact parameter signature (dynamic lookup avoids any
--    risk of a signature mismatch silently leaving one behind). Safe now
--    that every table/policy that could reference them is already gone.
--    No CASCADE - each drop is unqualified because nothing depends on
--    these functions anymore at this point.
-- ============================================================

do $$
declare
  r record;
  v_names text[] := array[
    'accept_organization_invitation',
    'cancel_organization_invitation',
    'check_invitation_email_has_account',
    'create_organization_invitation',
    'create_organization_with_ceo',
    'get_organization_appointment_breakdown',
    'get_organization_audit_log',
    'get_organization_branch_ids',
    'get_organization_branch_performance',
    'get_organization_expense_breakdown',
    'get_organization_expense_trend',
    'get_organization_highest_value_inventory',
    'get_organization_invitation_details',
    'get_organization_low_stock_items',
    'get_organization_pending_invitations',
    'get_organization_recent_activity',
    'get_organization_recent_grn_receipts',
    'get_organization_recent_purchase_orders',
    'get_organization_revenue_trend',
    'get_organization_supplier_spend',
    'get_organization_team_roster',
    'is_organization_ceo',
    'is_organization_member',
    'link_organization_invitation_provisioned_user',
    'log_organization_audit_event',
    'reactivate_clinic_user_for_organization',
    'reactivate_organization_member',
    'remove_clinic_user_for_organization',
    'remove_organization_member',
    'resend_organization_invitation',
    'resolve_organization_user_identity',
    'search_organization_patients',
    'set_organization_invitation_email_status',
    'suspend_clinic_user_for_organization',
    'suspend_organization_member',
    'switch_active_branch',
    'update_organization_member'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_names)
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;
