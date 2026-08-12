-- Fixes two independent, confirmed multi-branch bugs found during manual
-- testing:
--
--  BUG 1 (42703, "column email does not exist" from
--  create_organization_invitation): migration 0016's `create table if not
--  exists public.organization_invitations` is a no-op against a table
--  that already exists - and this table already existed on the live
--  database under an EARLIER, pre-"email" column name from before this
--  feature's schema was finalized. `create table if not exists` never
--  reconciles an existing table's columns, but the `create or replace
--  function` statements later in the same migration (create_organization_
--  invitation, get_organization_invitation_details,
--  accept_organization_invitation) DID get redeployed with "email"
--  references baked in, since function replacement isn't gated by "if not
--  exists" the way table creation is. The result: function code and table
--  schema silently diverged - the functions compile fine (PL/pgSQL only
--  validates column references at execution time, not at CREATE FUNCTION
--  time) but fail the moment they actually run a query against the real
--  column.
--
--  Per the "database schema is the source of truth, do not blindly
--  rename" instruction: rather than hardcoding a guessed legacy column
--  name, the block below inspects information_schema.columns at
--  migration-run-time for whichever email-like column actually exists,
--  and only renames it to "email" if a real, unambiguous match is found.
--  If "email" already exists, this is a silent no-op (safe to re-run). If
--  no candidate is found at all, it raises a clear exception naming what
--  it checked, rather than doing nothing and leaving the mismatch to
--  resurface later as the same opaque 42703.
--
--  BUG 2 (42702, "column reference clinic_id is ambiguous" from
--  switch_active_branch, migration 0017): the function's own
--  `returns table (clinic_id uuid, clinic_user_id uuid, role text)`
--  implicitly declares `clinic_id` as an output variable in scope for the
--  entire function body - exactly like a declared PL/pgSQL variable. Two
--  WHERE clauses queried public.clinic_users / public.organization_user_
--  branches (both of which also have a clinic_id column) using a bare,
--  unqualified `clinic_id`, which Postgres cannot resolve between the
--  table column and the output variable. Record-field accesses like
--  `v_existing.clinic_id` were never ambiguous (dotted references bind
--  directly to the named variable), which is why the bug was intermittent
--  -feeling rather than immediate - it only fires on the branch where a
--  fresh clinic_users row doesn't already exist for the caller.
--
--  Fix: qualify every table-column clinic_id reference with its table's
--  alias throughout the function (not just the two that error - all of
--  them, for defense in depth), and leave the RETURNS TABLE output shape
--  untouched, since services/organizations.ts#switchActiveBranch reads
--  `result.clinic_id` from the RPC response and renaming the OUTPUT
--  column would be a breaking API change instead of a bug fix.
--
-- Safe to re-run: the email-column fix is fully idempotent (checked via
-- information_schema before acting), and switch_active_branch uses
-- `create or replace` with its signature unchanged.

-- ============================================================
-- BUG 1 FIX - organization_invitations email column
-- ============================================================

do $$
declare
  v_actual_column text;
  v_candidates text[] := array[
    'invitee_email', 'recipient_email', 'member_email', 'email_address'
  ];
  v_candidate text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'organization_invitations'
  ) then
    raise notice 'organization_invitations does not exist yet - nothing to fix (migration 0016 will create it correctly).';
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_invitations'
      and column_name = 'email'
  ) then
    raise notice 'organization_invitations.email already exists - no rename needed.';
    return;
  end if;

  foreach v_candidate in array v_candidates loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'organization_invitations'
        and column_name = v_candidate
    ) then
      v_actual_column := v_candidate;
      exit;
    end if;
  end loop;

  if v_actual_column is null then
    raise exception
      'organization_invitations has no "email" column and none of the known legacy names (%) were found. Run: select column_name from information_schema.columns where table_schema = ''public'' and table_name = ''organization_invitations''; and report the actual email-holding column name.',
      array_to_string(v_candidates, ', ');
  end if;

  execute format(
    'alter table public.organization_invitations rename column %I to email',
    v_actual_column
  );

  raise notice 'Renamed organization_invitations.% to email.', v_actual_column;
end $$;

-- ============================================================
-- BUG 2 FIX - switch_active_branch clinic_id ambiguity
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
    select cu.id into v_new_id
    from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;
  end if;

  return query select p_clinic_id, v_new_id, v_new_role;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;
