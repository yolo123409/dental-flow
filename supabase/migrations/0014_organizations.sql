-- DentalFlow Enterprise, Phase 2: Organization / Multi-Branch foundation.
--
-- Introduces a new tenancy layer ABOVE clinics for dental groups running
-- multiple branches: organizations, organization_users (CEO/Partner/
-- Manager/Viewer membership), organization_user_branches (which branches a
-- member can see), and clinics.organization_id (nullable - independent
-- clinics never set it and are completely unaffected).
--
-- This migration is schema-only. No branch switching, no invitations, no
-- dashboard - those are later phases. No application code changes
-- alongside it. One existing policy IS redeclared (clinics_update_admin_only,
-- section 8) with a narrow, backward-compatible addition - see that
-- section for why a column-level REVOKE doesn't actually work here and
-- RLS is the only real fix.
--
-- THE ONE HARD REQUIREMENT: each organization has exactly one Primary CEO,
-- ever, enforced at the database level (not just in application code) via
-- a partial unique index on organization_users(organization_id) where
-- role = 'CEO'. See section 2.
--
-- Design note for whoever builds Phase 3 (branch switching): organization
-- members will get access to a branch's existing patients/appointments/
-- etc. by being lazily granted a REAL clinic_users row for that branch
-- (tagged via a future clinic_users.organization_user_id column), not by
-- rewriting the ~24+ existing clinic-scoped RLS policies to also check
-- organization membership. That keeps every existing policy and every
-- existing service function (which all resolve "current clinic" through
-- clinic_users) working completely unchanged. This migration lays the
-- groundwork for that but does not implement it.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR
-- REPLACE / DROP POLICY IF EXISTS), matching every other migration in
-- this folder.

-- ============================================================
-- 1. organizations
--
--    primary_owner_user_id is a non-authoritative "founder" pointer, set
--    once at creation and never updated by anything in this migration -
--    the real, live source of truth for who is CEO is always
--    organization_users.role = 'CEO' (section 2). Do not treat this
--    column as "current owner" if ownership transfer is ever built later;
--    that work must update both in the same transaction or this column
--    will silently drift.
--
--    This is the first table in this schema with a real foreign key to
--    auth.users - every existing table only matches identity via
--    auth.uid() inside RLS policies, never a formal FK. on delete
--    restrict so a CEO's auth account can't be deleted out from under a
--    live organization without deliberate handling.
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),

  name text not null,

  primary_owner_user_id uuid not null references auth.users(id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. organization_users - organization-level membership, separate from
--    (and above) clinic_users. Exactly one CEO row per organization,
--    enforced below by a partial unique index - the spec's hard
--    requirement, not just an application-level check.
--
--    full_name/email are stored here redundantly (same pattern as
--    clinic_users, which stores them per-clinic-row) because this schema
--    has no central user-profile table and auth.users isn't readable
--    client-side without service-role access - Team & Access UI (later
--    phase) needs a name/email to display for each member without one.
-- ============================================================

create table if not exists public.organization_users (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  user_id uuid not null references auth.users(id) on delete cascade,

  full_name text not null,
  email text not null,

  role text not null check (role in ('CEO', 'Partner', 'Manager', 'Viewer')),

  branch_access text not null default 'selected'
    check (branch_access in ('all', 'selected')),

  status text not null default 'Active'
    check (status in ('Active', 'Removed')),

  invited_by uuid references public.organization_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists idx_organization_users_organization_id
  on public.organization_users(organization_id);

create index if not exists idx_organization_users_user_id
  on public.organization_users(user_id);

-- Exactly one CEO per organization, ever. Not filtered by status: no
-- exposed path anywhere in this migration can change a CEO row's role or
-- status (the update/delete policies below explicitly exclude role='CEO'
-- rows), so this predicate is currently unreachable to violate either
-- way. A future ownership-transfer feature must demote the old CEO's role
-- in the SAME transaction as promoting the new one, or this index will
-- correctly block the promotion.
create unique index if not exists uq_organization_users_one_ceo_per_org
  on public.organization_users(organization_id)
  where role = 'CEO';

-- ============================================================
-- 3. is_organization_member / is_organization_ceo - SECURITY DEFINER
--    helpers, same shape and same reason as is_clinic_owner_or_admin
--    (0008): organization_users' own RLS policies need to query
--    organization_users, which is the exact self-referential case that
--    causes "infinite recursion detected in policy" (42P17) with a plain
--    EXISTS. MUST be language plpgsql, not sql - a sql function this
--    simple is eligible for planner inlining, which discards the
--    security definer bypass and reproduces the same recursion.
--
--    Both filter status = 'Active' internally, so a removed member's row
--    stops satisfying membership/CEO checks immediately - the check lives
--    here, not left to every caller to remember.
-- ============================================================

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.organization_users ou
    where ou.user_id = auth.uid()
      and ou.organization_id = p_organization_id
      and ou.status = 'Active'
  );
end;
$$;

grant execute on function public.is_organization_member(uuid) to authenticated;

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
    where ou.user_id = auth.uid()
      and ou.organization_id = p_organization_id
      and ou.status = 'Active'
      and ou.role = 'CEO'
  );
end;
$$;

grant execute on function public.is_organization_ceo(uuid) to authenticated;

-- ============================================================
-- 4. organizations RLS. No insert policy (only
--    create_organization_with_ceo, section 6, can create a row) and no
--    delete policy (organization deletion isn't a supported operation in
--    this phase). Update policy has an explicit matching "with check"
--    rather than relying on the implicit default, matching 0010's
--    defense-in-depth convention.
-- ============================================================

alter table public.organizations enable row level security;

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations for select
  using (public.is_organization_member(organizations.id));

drop policy if exists "organizations_update_ceo_only" on public.organizations;
create policy "organizations_update_ceo_only"
  on public.organizations for update
  using (public.is_organization_ceo(organizations.id))
  with check (public.is_organization_ceo(organizations.id));

-- ============================================================
-- 5. organization_users RLS. No insert policy (only
--    create_organization_with_ceo, and later Phase 4's invitation-
--    acceptance RPC, can create rows). Update/delete require the caller
--    to be CEO of the organization AND the target row's role to not be
--    'CEO' - protects the CEO row from being changed or removed by
--    anyone, including the CEO's own account through this policy. No
--    ownership-transfer path is implemented in this phase, by design.
-- ============================================================

alter table public.organization_users enable row level security;

drop policy if exists "organization_users_select_member" on public.organization_users;
create policy "organization_users_select_member"
  on public.organization_users for select
  using (public.is_organization_member(organization_users.organization_id));

drop policy if exists "organization_users_update_ceo_only" on public.organization_users;
create policy "organization_users_update_ceo_only"
  on public.organization_users for update
  using (
    organization_users.role <> 'CEO'
    and public.is_organization_ceo(organization_users.organization_id)
  )
  with check (
    role <> 'CEO'
    and public.is_organization_ceo(organization_id)
  );

drop policy if exists "organization_users_delete_ceo_only" on public.organization_users;
create policy "organization_users_delete_ceo_only"
  on public.organization_users for delete
  using (
    organization_users.role <> 'CEO'
    and public.is_organization_ceo(organization_users.organization_id)
  );

-- ============================================================
-- 6. create_organization_with_ceo - the only way an organization is
--    created, same shape as create_clinic_with_admin (0001/0008): derives
--    identity only from auth.uid(), raises if the caller already has ANY
--    organization_users row (one CEO registration per person - this is
--    what actually prevents "register as CEO of an existing org" per the
--    spec, not a name lookup), atomically inserts organizations + the
--    caller's own organization_users row. Does NOT create a clinic/branch
--    - that's Phase 3, reusing create_clinic_with_admin plus setting
--    organization_id via a companion RPC designed then.
-- ============================================================

create or replace function public.create_organization_with_ceo(
  p_organization_name text,
  p_owner_full_name text,
  p_owner_email text
)
returns table (organization_id uuid, organization_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_organization_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.organization_users where user_id = v_uid) then
    raise exception 'This account is already linked to an organization';
  end if;

  if p_organization_name is null or length(trim(p_organization_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  if p_owner_full_name is null or length(trim(p_owner_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  insert into public.organizations (name, primary_owner_user_id)
  values (trim(p_organization_name), v_uid)
  returning id into v_organization_id;

  insert into public.organization_users (
    organization_id, user_id, full_name, email, role, branch_access, status, invited_by
  )
  values (
    v_organization_id, v_uid, trim(p_owner_full_name), lower(trim(p_owner_email)),
    'CEO', 'all', 'Active', null
  )
  returning id into v_organization_user_id;

  return query select v_organization_id, v_organization_user_id;
end;
$$;

grant execute on function public.create_organization_with_ceo(text, text, text)
  to authenticated;

-- ============================================================
-- 7. organization_user_branches - which branches a 'selected'-access
--    member can see. Rows are add/remove only (no update policy). CEO
--    manages membership branch access; a member can read their own scope.
--
--    Documented invariant, NOT enforced by a constraint in this migration:
--    a row's clinic_id must belong to the SAME organization as
--    organization_user_id's organization_id. Nothing here checks that
--    cross-reference. Phase 3's lazy branch-provisioning RPC MUST verify
--    clinics.organization_id = organization_users.organization_id before
--    granting real clinic_users access from a row here, or a
--    misconfigured organization could self-grant access to an
--    unaffiliated clinic.
-- ============================================================

create table if not exists public.organization_user_branches (
  id uuid primary key default gen_random_uuid(),

  organization_user_id uuid not null
    references public.organization_users(id) on delete cascade,

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  created_at timestamptz not null default now(),

  unique (organization_user_id, clinic_id)
);

create index if not exists idx_organization_user_branches_org_user_id
  on public.organization_user_branches(organization_user_id);

create index if not exists idx_organization_user_branches_clinic_id
  on public.organization_user_branches(clinic_id);

alter table public.organization_user_branches enable row level security;

drop policy if exists "organization_user_branches_select_member" on public.organization_user_branches;
create policy "organization_user_branches_select_member"
  on public.organization_user_branches for select
  using (
    exists (
      select 1 from public.organization_users ou
      where ou.id = organization_user_branches.organization_user_id
        and public.is_organization_member(ou.organization_id)
    )
  );

drop policy if exists "organization_user_branches_insert_ceo_only" on public.organization_user_branches;
create policy "organization_user_branches_insert_ceo_only"
  on public.organization_user_branches for insert
  with check (
    exists (
      select 1 from public.organization_users ou
      where ou.id = organization_user_branches.organization_user_id
        and public.is_organization_ceo(ou.organization_id)
    )
  );

drop policy if exists "organization_user_branches_delete_ceo_only" on public.organization_user_branches;
create policy "organization_user_branches_delete_ceo_only"
  on public.organization_user_branches for delete
  using (
    exists (
      select 1 from public.organization_users ou
      where ou.id = organization_user_branches.organization_user_id
        and public.is_organization_ceo(ou.organization_id)
    )
  );

-- ============================================================
-- 8. clinics.organization_id - nullable, independent clinics stay null
--    forever, zero impact on existing clinics.
--
--    The existing clinics_update_admin_only policy's `with check` (added
--    in 0010) only re-validates is_clinic_owner_or_admin(clinics.id) -
--    it says nothing about organization_id, so without the change below,
--    any clinic's own Owner/Admin could set/change organization_id via a
--    normal .update() call, self-linking their clinic into ANY
--    organization they can guess a UUID for. A column-level REVOKE was
--    considered instead but doesn't actually work here: Postgres
--    column-level privilege revokes never override a broader table-level
--    grant, and `authenticated` already holds table-level UPDATE on
--    clinics (that's what every legitimate clinic-settings update relies
--    on) - so RLS is the only mechanism that can actually enforce this.
--
--    The narrow fix: redeclare clinics_update_admin_only (originally
--    0008, hardened with `with check` in 0010) so its with check ALSO
--    requires organization_id to be either unchanged/null, or the caller
--    to be CEO of that specific target organization. Every existing
--    update flow (name/email/plan, never touching organization_id) is
--    completely unaffected - organization_id stays null on the new row in
--    every one of those cases, satisfying `organization_id is null`. Only
--    an update that explicitly sets organization_id to a non-null value
--    is newly gated, and only that gate is new - is_clinic_owner_or_admin
--    is unchanged from 0010.
-- ============================================================

alter table public.clinics
  add column if not exists organization_id uuid
    references public.organizations(id) on delete set null;

create index if not exists idx_clinics_organization_id
  on public.clinics(organization_id);

drop policy if exists "clinics_update_admin_only" on public.clinics;
create policy "clinics_update_admin_only"
  on public.clinics for update
  using (public.is_clinic_owner_or_admin(clinics.id))
  with check (
    public.is_clinic_owner_or_admin(clinics.id)
    and (organization_id is null or public.is_organization_ceo(organization_id))
  );
