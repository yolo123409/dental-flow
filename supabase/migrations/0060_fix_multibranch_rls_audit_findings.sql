-- Comprehensive fix for the RLS audit triggered by discovering
-- clinic_invoices had the identical broken-RLS pattern as patients
-- (fixed in 0057). A full audit of every clinic-scoped table's
-- policies (via pg_policies) turned up the same bug on several more
-- tables, plus two unrelated and more severe issues. This migration
-- addresses all of them together. Three distinct bug classes:
--
-- PART 1 - Wrong-column comparison. Legacy policies (visible by their
-- Title-Case names, e.g. "Invoices Select", "Charges Delete") compare
-- clinic_users.id (that table's own generated primary key) to
-- auth.uid(), instead of clinic_users.auth_user_id = auth.uid(). This
-- appears to date back to an early convention where clinic_users.id
-- was once set equal to the owner's auth_user_id, which broke once
-- clinic_users.id became its own independently-generated UUID
-- (supporting multiple staff per clinic). Net effect: these policies
-- never match anything for real logged-in users, so they only ever
-- DENY access - they are not a security leak, just dead weight. Fixed
-- the same way as patients in 0057: add new, correctly-scoped
-- policies alongside the old broken ones (RLS policies are OR'd
-- together, so this is purely additive and safe to re-run). The old
-- policies are deliberately left in place, matching 0057's own
-- precedent of never dropping unrecognized existing policies for this
-- bug class.
--
-- PART 2 - Multi-branch arbitrary-pick bug on patient_notes. Same root
-- cause as the ledger RPC bugs fixed in 0058/0059, but manifesting as
-- an RLS policy instead of a function: `clinic_id = (SELECT
-- clinic_users.clinic_id FROM clinic_users WHERE auth_user_id =
-- auth.uid() LIMIT 1)`. For a multi-branch user this arbitrarily picks
-- ONE of their clinic_users rows regardless of which branch's notes
-- they're actually trying to reach - an access-denial bug for
-- whichever branch isn't picked, not a cross-tenant leak (it never
-- matches a clinic the caller doesn't genuinely belong to). Fixed
-- additively, same as Part 1.
--
-- PART 3 - patient_teeth: a SEPARATE and materially more severe bug.
-- Four policies literally named "Allow reads/inserts/updates/deletes"
-- with qual/with_check hard-coded to `true` - meaning ANY authenticated
-- user, from ANY clinic, can read and write ANY other clinic's dental
-- chart data. This is an active cross-tenant data leak, not merely an
-- access-denial bug, so the usual "never drop existing policies"
-- precedent does not apply here: an additive correct policy would
-- change nothing, since `true OR <anything>` is still `true`. These
-- unconditional policies must be dropped for the fix to have any
-- effect. Found dynamically (by qual/with_check = 'true') rather than
-- by hard-coded policy name, so this is robust to the exact wording of
-- the policy names in the live database.
--
-- PART 4 - treatments: RLS is disabled entirely (relrowsecurity =
-- false), despite the table having a clinic_id column and being
-- actively queried by services/analytics/treatments.ts with
-- client-side .eq("clinic_id", ...) filtering only. With RLS off,
-- access control depends entirely on table-level grants, which are
-- typically broad for the `authenticated` role in Supabase - so this
-- table has likely been fully cross-tenant readable/writable with zero
-- database-level enforcement. Fixed by enabling RLS and adding the
-- same correctly-scoped policies used everywhere else. This does not
-- change legitimate app behavior (the app already filters by
-- clinic_id on every query against this table), it only closes the
-- enforcement gap.
--
-- Deliberately NOT addressed in this migration (flagged separately,
-- not urgent security holes):
--   - clinic_settings has no INSERT/DELETE policy. Rows are created via
--     a security-definer onboarding RPC and the app never deletes a
--     clinic_settings row, so this is very likely unreachable in
--     practice rather than a live gap.
--   - clinic_users has no self-UPDATE policy (only owner/admin-gated
--     "staff management" updates), so a regular staff member cannot
--     update their own profile fields. Deliberately deferred: a naive
--     self-UPDATE policy would let staff rewrite ANY column on their
--     own row, including role/clinic_id/is_active - a privilege
--     escalation risk - and doing this safely needs either a
--     column-restricted approach or a BEFORE UPDATE trigger, not a
--     rushed addition to a security-fix migration.
--   - staff_invitations, treatment_plan_items, treatment_plans were
--     all audited and are already correctly scoped - no changes.

-- ============================================================
-- PART 1: wrong-column bug - additive fix
-- ============================================================

-- clinic_invoices
drop policy if exists "clinic_invoices_select_own_clinic" on public.clinic_invoices;
create policy "clinic_invoices_select_own_clinic"
  on public.clinic_invoices for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_invoices.clinic_id
  ));

drop policy if exists "clinic_invoices_insert_own_clinic" on public.clinic_invoices;
create policy "clinic_invoices_insert_own_clinic"
  on public.clinic_invoices for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_invoices.clinic_id
  ));

drop policy if exists "clinic_invoices_update_own_clinic" on public.clinic_invoices;
create policy "clinic_invoices_update_own_clinic"
  on public.clinic_invoices for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_invoices.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_invoices.clinic_id
  ));

drop policy if exists "clinic_invoices_delete_own_clinic" on public.clinic_invoices;
create policy "clinic_invoices_delete_own_clinic"
  on public.clinic_invoices for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_invoices.clinic_id
  ));

-- clinic_charges
drop policy if exists "clinic_charges_select_own_clinic" on public.clinic_charges;
create policy "clinic_charges_select_own_clinic"
  on public.clinic_charges for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_charges.clinic_id
  ));

drop policy if exists "clinic_charges_insert_own_clinic" on public.clinic_charges;
create policy "clinic_charges_insert_own_clinic"
  on public.clinic_charges for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_charges.clinic_id
  ));

drop policy if exists "clinic_charges_update_own_clinic" on public.clinic_charges;
create policy "clinic_charges_update_own_clinic"
  on public.clinic_charges for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_charges.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_charges.clinic_id
  ));

drop policy if exists "clinic_charges_delete_own_clinic" on public.clinic_charges;
create policy "clinic_charges_delete_own_clinic"
  on public.clinic_charges for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_charges.clinic_id
  ));

-- clinic_payments
drop policy if exists "clinic_payments_select_own_clinic" on public.clinic_payments;
create policy "clinic_payments_select_own_clinic"
  on public.clinic_payments for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_payments.clinic_id
  ));

drop policy if exists "clinic_payments_insert_own_clinic" on public.clinic_payments;
create policy "clinic_payments_insert_own_clinic"
  on public.clinic_payments for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_payments.clinic_id
  ));

drop policy if exists "clinic_payments_update_own_clinic" on public.clinic_payments;
create policy "clinic_payments_update_own_clinic"
  on public.clinic_payments for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_payments.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_payments.clinic_id
  ));

drop policy if exists "clinic_payments_delete_own_clinic" on public.clinic_payments;
create policy "clinic_payments_delete_own_clinic"
  on public.clinic_payments for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_payments.clinic_id
  ));

-- clinic_treatments
drop policy if exists "clinic_treatments_select_own_clinic" on public.clinic_treatments;
create policy "clinic_treatments_select_own_clinic"
  on public.clinic_treatments for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_treatments.clinic_id
  ));

drop policy if exists "clinic_treatments_insert_own_clinic" on public.clinic_treatments;
create policy "clinic_treatments_insert_own_clinic"
  on public.clinic_treatments for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_treatments.clinic_id
  ));

drop policy if exists "clinic_treatments_update_own_clinic" on public.clinic_treatments;
create policy "clinic_treatments_update_own_clinic"
  on public.clinic_treatments for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_treatments.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_treatments.clinic_id
  ));

drop policy if exists "clinic_treatments_delete_own_clinic" on public.clinic_treatments;
create policy "clinic_treatments_delete_own_clinic"
  on public.clinic_treatments for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_treatments.clinic_id
  ));

-- patient_tooth_files
drop policy if exists "patient_tooth_files_select_own_clinic" on public.patient_tooth_files;
create policy "patient_tooth_files_select_own_clinic"
  on public.patient_tooth_files for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_files.clinic_id
  ));

drop policy if exists "patient_tooth_files_insert_own_clinic" on public.patient_tooth_files;
create policy "patient_tooth_files_insert_own_clinic"
  on public.patient_tooth_files for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_files.clinic_id
  ));

drop policy if exists "patient_tooth_files_update_own_clinic" on public.patient_tooth_files;
create policy "patient_tooth_files_update_own_clinic"
  on public.patient_tooth_files for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_files.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_files.clinic_id
  ));

drop policy if exists "patient_tooth_files_delete_own_clinic" on public.patient_tooth_files;
create policy "patient_tooth_files_delete_own_clinic"
  on public.patient_tooth_files for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_files.clinic_id
  ));

-- patient_tooth_folders
drop policy if exists "patient_tooth_folders_select_own_clinic" on public.patient_tooth_folders;
create policy "patient_tooth_folders_select_own_clinic"
  on public.patient_tooth_folders for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_folders.clinic_id
  ));

drop policy if exists "patient_tooth_folders_insert_own_clinic" on public.patient_tooth_folders;
create policy "patient_tooth_folders_insert_own_clinic"
  on public.patient_tooth_folders for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_folders.clinic_id
  ));

drop policy if exists "patient_tooth_folders_update_own_clinic" on public.patient_tooth_folders;
create policy "patient_tooth_folders_update_own_clinic"
  on public.patient_tooth_folders for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_folders.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_folders.clinic_id
  ));

drop policy if exists "patient_tooth_folders_delete_own_clinic" on public.patient_tooth_folders;
create policy "patient_tooth_folders_delete_own_clinic"
  on public.patient_tooth_folders for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_folders.clinic_id
  ));

-- patient_tooth_history
drop policy if exists "patient_tooth_history_select_own_clinic" on public.patient_tooth_history;
create policy "patient_tooth_history_select_own_clinic"
  on public.patient_tooth_history for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_history.clinic_id
  ));

drop policy if exists "patient_tooth_history_insert_own_clinic" on public.patient_tooth_history;
create policy "patient_tooth_history_insert_own_clinic"
  on public.patient_tooth_history for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_history.clinic_id
  ));

drop policy if exists "patient_tooth_history_update_own_clinic" on public.patient_tooth_history;
create policy "patient_tooth_history_update_own_clinic"
  on public.patient_tooth_history for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_history.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_history.clinic_id
  ));

drop policy if exists "patient_tooth_history_delete_own_clinic" on public.patient_tooth_history;
create policy "patient_tooth_history_delete_own_clinic"
  on public.patient_tooth_history for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_tooth_history.clinic_id
  ));

-- ============================================================
-- PART 2: patient_notes - multi-branch arbitrary-pick bug - additive fix
-- ============================================================

drop policy if exists "patient_notes_select_own_clinic" on public.patient_notes;
create policy "patient_notes_select_own_clinic"
  on public.patient_notes for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_notes.clinic_id
  ));

drop policy if exists "patient_notes_insert_own_clinic" on public.patient_notes;
create policy "patient_notes_insert_own_clinic"
  on public.patient_notes for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_notes.clinic_id
  ));

drop policy if exists "patient_notes_update_own_clinic" on public.patient_notes;
create policy "patient_notes_update_own_clinic"
  on public.patient_notes for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_notes.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_notes.clinic_id
  ));

drop policy if exists "patient_notes_delete_own_clinic" on public.patient_notes;
create policy "patient_notes_delete_own_clinic"
  on public.patient_notes for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_notes.clinic_id
  ));

-- ============================================================
-- PART 3: patient_teeth - active cross-tenant leak - DROP + replace
-- ============================================================

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename = 'patient_teeth'
      and (qual = 'true' or with_check = 'true')
  loop
    execute format('drop policy %I on public.patient_teeth', pol.policyname);
  end loop;
end $$;

drop policy if exists "patient_teeth_select_own_clinic" on public.patient_teeth;
create policy "patient_teeth_select_own_clinic"
  on public.patient_teeth for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_teeth.clinic_id
  ));

drop policy if exists "patient_teeth_insert_own_clinic" on public.patient_teeth;
create policy "patient_teeth_insert_own_clinic"
  on public.patient_teeth for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_teeth.clinic_id
  ));

drop policy if exists "patient_teeth_update_own_clinic" on public.patient_teeth;
create policy "patient_teeth_update_own_clinic"
  on public.patient_teeth for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_teeth.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_teeth.clinic_id
  ));

drop policy if exists "patient_teeth_delete_own_clinic" on public.patient_teeth;
create policy "patient_teeth_delete_own_clinic"
  on public.patient_teeth for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = patient_teeth.clinic_id
  ));

-- ============================================================
-- PART 4: treatments - RLS disabled entirely - enable + add policies
-- ============================================================

alter table public.treatments enable row level security;

drop policy if exists "treatments_select_own_clinic" on public.treatments;
create policy "treatments_select_own_clinic"
  on public.treatments for select
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = treatments.clinic_id
  ));

drop policy if exists "treatments_insert_own_clinic" on public.treatments;
create policy "treatments_insert_own_clinic"
  on public.treatments for insert
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = treatments.clinic_id
  ));

drop policy if exists "treatments_update_own_clinic" on public.treatments;
create policy "treatments_update_own_clinic"
  on public.treatments for update
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = treatments.clinic_id
  ))
  with check (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = treatments.clinic_id
  ));

drop policy if exists "treatments_delete_own_clinic" on public.treatments;
create policy "treatments_delete_own_clinic"
  on public.treatments for delete
  using (exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid() and cu.clinic_id = treatments.clinic_id
  ));
