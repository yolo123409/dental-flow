-- Fixes a critical, pre-existing bug in `patients` row-level security,
-- discovered while testing Phase 7 (CEO Organization Dashboard) of the
-- multi-branch build - completely unrelated to multi-branch itself,
-- confirmed to affect every independent clinic too via the real
-- signup -> login -> Add Patient UI flow (new patient creation fails
-- outright with 42501, and reading back existing patients silently
-- returns zero rows).
--
-- `patients` was never given RLS via any tracked migration (see
-- migration 0040's own header) - its SELECT/INSERT/UPDATE/DELETE
-- policies were configured directly against the live project, outside
-- version control. Live introspection (pg_policies, run by the user
-- since no DB/migration-apply access exists in this environment) shows
-- four such policies - "Patients Select", "Patients Insert", "Patients
-- Update", "Patients Delete" - all sharing the same bug:
--
--   clinic_id = (select clinic_users.clinic_id from clinic_users
--                where clinic_users.id = auth.uid())
--
-- `clinic_users.id` is that table's own primary key (a generated uuid
-- for the STAFF ROW), not the person's auth user id - the correct
-- column, used correctly by every other RLS policy in this schema
-- (clinic_users_select_self, dentists_all_own_clinic,
-- patients_insert_own_clinic itself), is `clinic_users.auth_user_id`.
-- For any clinic_users row where id doesn't coincidentally equal
-- auth_user_id (i.e. essentially every clinic created after
-- clinic_users.id became its own generated primary key rather than
-- being set equal to the owner's auth id, a since-abandoned early
-- convention), the subquery matches zero rows, evaluates to NULL, and
-- `clinic_id = NULL` is never true - so these four policies silently
-- deny SELECT/UPDATE/DELETE for every real clinic. Even though a
-- working INSERT policy already exists (patients_insert_own_clinic,
-- migration 0040), .insert().select() (used throughout this app to add
-- a patient and get it back) still fails: the INSERT itself passes via
-- that policy, but returning the newly-inserted row also requires it to
-- satisfy a SELECT policy, and none currently does for a normal clinic.
--
-- Fix: purely additive, matching migration 0040's own precedent of
-- never dropping an unrecognized existing policy - add three new,
-- correctly-scoped PERMISSIVE policies for SELECT/UPDATE/DELETE, using
-- the exact same proven clinic_users-membership pattern already used by
-- patients_insert_own_clinic and dentists_all_own_clinic. No new INSERT
-- policy is needed - patients_insert_own_clinic is already correct.
-- Postgres OR's multiple permissive policies for the same command
-- together, so this can only widen access to legitimate clinic members
-- - it cannot weaken or conflict with the four pre-existing (broken but
-- harmless, since they simply never matched anything) legacy policies,
-- which are deliberately left in place rather than guessed-at and
-- dropped.
--
-- Safe to re-run: drop-if-exists + create, matching this project's
-- every-migration-safe-to-rerun convention.

drop policy if exists "patients_select_own_clinic" on public.patients;
create policy "patients_select_own_clinic"
  on public.patients for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patients.clinic_id
    )
  );

drop policy if exists "patients_update_own_clinic" on public.patients;
create policy "patients_update_own_clinic"
  on public.patients for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patients.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patients.clinic_id
    )
  );

drop policy if exists "patients_delete_own_clinic" on public.patients;
create policy "patients_delete_own_clinic"
  on public.patients for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patients.clinic_id
    )
  );
