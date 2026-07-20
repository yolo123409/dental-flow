-- Database schema audit: tightened nullable clinic_id columns that
-- should never legitimately be null, and added indexes on the columns
-- every RLS policy and application query actually filters by. Postgres
-- does not auto-index foreign key columns (only the referenced PK
-- side), and this app's entire query pattern - every service function,
-- every RLS policy added this session - filters by clinic_id first,
-- so its absence is a real, scale-relevant gap.
--
-- Verified against the live project before writing this: zero existing
-- NULL clinic_id values in any of the tables below, so the NOT NULL
-- additions are safe with no data to reconcile.
--
-- Not included here (flagged as a recommendation instead, not a
-- migration): dropping the unused legacy tables (orders, products,
-- purchases, invoices, payments, patient_files, profiles) found during
-- this audit - none are referenced by any application code, but
-- dropping tables is destructive and irreversible, so that's a decision
-- for you to make deliberately, not something to bundle into a routine
-- migration.
--
-- Safe to re-run: idempotent (IF NOT EXISTS / DO block guards).

-- ============================================================
-- 1. NOT NULL on clinic_id where it was nullable but shouldn't be
-- ============================================================

do $$
begin
  if not exists (select 1 from public.patients where clinic_id is null) then
    alter table public.patients alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.appointments where clinic_id is null) then
    alter table public.appointments alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.patient_teeth where clinic_id is null) then
    alter table public.patient_teeth alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.patient_tooth_history where clinic_id is null) then
    alter table public.patient_tooth_history alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.patient_tooth_folders where clinic_id is null) then
    alter table public.patient_tooth_folders alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.patient_tooth_files where clinic_id is null) then
    alter table public.patient_tooth_files alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.clinic_users where clinic_id is null) then
    alter table public.clinic_users alter column clinic_id set not null;
  end if;
end $$;

-- ============================================================
-- 2. clinic_id indexes - every clinic-scoped table's primary access
--    pattern throughout the app and its RLS policies
-- ============================================================

create index if not exists idx_patients_clinic_id on public.patients(clinic_id);
create index if not exists idx_appointments_clinic_id on public.appointments(clinic_id);
create index if not exists idx_dentists_clinic_id on public.dentists(clinic_id);
create index if not exists idx_patient_teeth_clinic_id on public.patient_teeth(clinic_id);
create index if not exists idx_patient_tooth_history_clinic_id on public.patient_tooth_history(clinic_id);
create index if not exists idx_patient_tooth_folders_clinic_id on public.patient_tooth_folders(clinic_id);
create index if not exists idx_patient_tooth_files_clinic_id on public.patient_tooth_files(clinic_id);
create index if not exists idx_patient_notes_clinic_id on public.patient_notes(clinic_id);
create index if not exists idx_clinic_charges_clinic_id on public.clinic_charges(clinic_id);
create index if not exists idx_clinic_invoices_clinic_id on public.clinic_invoices(clinic_id);
create index if not exists idx_clinic_payments_clinic_id on public.clinic_payments(clinic_id);
create index if not exists idx_clinic_treatments_clinic_id on public.clinic_treatments(clinic_id);
create index if not exists idx_clinic_roles_clinic_id on public.clinic_roles(clinic_id);
create index if not exists idx_attachments_clinic_id on public.attachments(clinic_id);
create index if not exists idx_clinic_users_clinic_id on public.clinic_users(clinic_id);

-- Every RLS policy this session's migrations added runs
-- `where cu.auth_user_id = auth.uid()` against clinic_users - this is
-- the single most-executed lookup in the whole schema (once per
-- protected-table access, for every request), so it matters more than
-- almost anything else here.
create index if not exists idx_clinic_users_auth_user_id on public.clinic_users(auth_user_id);

-- ============================================================
-- 3. Secondary FK indexes for the other columns queries actually
--    join/filter on (patient profile loads, invoice detail pages, etc.)
-- ============================================================

create index if not exists idx_appointments_patient_id on public.appointments(patient_id);
create index if not exists idx_appointments_dentist_id on public.appointments(dentist_id);
create index if not exists idx_clinic_invoices_patient_id on public.clinic_invoices(patient_id);
create index if not exists idx_clinic_invoice_items_invoice_id on public.clinic_invoice_items(invoice_id);
create index if not exists idx_clinic_payments_invoice_id on public.clinic_payments(invoice_id);
create index if not exists idx_clinic_payments_patient_id on public.clinic_payments(patient_id);
create index if not exists idx_clinic_charges_patient_id on public.clinic_charges(patient_id);
create index if not exists idx_clinic_charges_invoice_id on public.clinic_charges(invoice_id);
create index if not exists idx_patient_notes_patient_id on public.patient_notes(patient_id);
create index if not exists idx_patient_teeth_patient_id on public.patient_teeth(patient_id);
create index if not exists idx_patient_tooth_history_patient_id on public.patient_tooth_history(patient_id);
create index if not exists idx_attachments_patient_id on public.attachments(patient_id);
