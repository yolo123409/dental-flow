-- Two independent, confirmed bugs found by live-testing directly against
-- this project (not by trusting tracked migration text - patients RLS was
-- never in a tracked migration to begin with; and switch_active_branch's
-- fix already existed in 0034's text but the live database was not
-- observed to be running it).
--
-- ============================================================
-- BUG 1 - patients has no working INSERT policy.
--
-- Confirmed live: a freshly-provisioned, correctly-authorized clinic_users
-- row (role=Admin/Owner, status=Active, matching clinic_id) still gets
-- 403/42501 on `insert into patients`, with NO .select() involved (so it
-- is the INSERT WITH CHECK itself, not a SELECT-for-return policy). A
-- control insert into `dentists` with the identical session/setup
-- succeeds, proving the session and clinic_users setup are valid and the
-- gap is specific to `patients`. SELECT was independently verified to
-- still correctly scope by clinic (no cross-clinic leak) - only INSERT is
-- affected.
--
-- `patients` was never given RLS via any tracked migration (grepped all
-- prior migration files - zero `create policy ... on patients`), so
-- whatever governs it today lives outside version control, like
-- `clinics`/`clinic_users` (see 0019's own note on that). Rather than
-- guessing at and dropping an unknown existing policy by name, this adds
-- ONE new INSERT policy using the exact same proven pattern already used
-- by ~24+ other clinic-scoped tables (verbatim copy of dentists_all_own_
-- clinic's WITH CHECK, 0001) - Postgres combines multiple permissive
-- policies for the same command with OR, so this is additive and safe: it
-- cannot weaken whatever SELECT/UPDATE/DELETE policy already correctly
-- scopes this table, and it cannot allow an insert for a clinic_id the
-- caller doesn't have a clinic_users row for.
--
-- Safe to re-run: drop-if-exists + create.
-- ============================================================

drop policy if exists "patients_insert_own_clinic" on public.patients;

create policy "patients_insert_own_clinic"
  on public.patients for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patients.clinic_id
    )
  );

-- ============================================================
-- BUG 2 - switch_active_branch re-applied.
--
-- 0034's version of this function (fully qualifies every clinic_id
-- reference: cu.clinic_id, oub.clinic_id, and resolves identity via
-- resolve_organization_user_identity instead of organization_users.
-- full_name/.email, which no longer exist) is the correct, intended
-- version - but live testing just now reproduced the exact 42702
-- "column reference clinic_id is ambiguous" error that 0031/0034 were
-- written to fix, on a first-time switch into a brand-new branch. Rather
-- than debug why the gap exists, this re-applies the known-correct 0034
-- body verbatim via create-or-replace - idempotent and harmless if 0034
-- was in fact already live, and closes the gap if it wasn't.
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

  v_new_role := 'Admin';

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
