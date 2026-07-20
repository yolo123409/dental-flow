-- Production-readiness security audit: cross-tenant RLS audit against a
-- live pair of throwaway clinics found three real leaks (full audit
-- script and results are not committed; every other clinic-scoped table -
-- patients, dentists, appointments, clinic_invoices, clinic_invoice_items,
-- clinic_charges, clinic_payments, clinic_treatments, patient_notes,
-- patient_tooth_history, clinics, clinic_settings, clinic_roles,
-- clinic_users - was verified isolated, including a cross-tenant WRITE
-- attempt):
--
-- 1. patient_teeth (odontogram/dental chart data) had a clinic_id column
--    but no working RLS policy restricting it to clinic members - any
--    authenticated user of ANY clinic could read any other clinic's
--    dental chart data.
-- 2. attachments (patient file/document records) has no clinic_id column
--    at all, only patient_id, and no RLS policy - any authenticated user
--    of any clinic could read any other clinic's attachment records.
--    (Not yet reachable through the UI - components/patients/
--    PatientDocuments.tsx exists but isn't wired into the patient profile
--    tabs yet - but the table/policy gap is real today regardless.)
-- 3. The patient-files storage bucket is private (blocks anonymous
--    access) but had no per-clinic policy on storage.objects - ANY
--    authenticated user of ANY clinic could download ANY other clinic's
--    uploaded files (x-rays, documents) by path. Confirmed by uploading
--    as Clinic A and successfully downloading as Clinic B's owner.
--
-- Safe to re-run: idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

-- ============================================================
-- 1. patient_teeth: add the missing policy (column already exists)
-- ============================================================

alter table public.patient_teeth enable row level security;

drop policy if exists "patient_teeth_all_own_clinic" on public.patient_teeth;
create policy "patient_teeth_all_own_clinic"
  on public.patient_teeth for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_teeth.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_teeth.clinic_id
    )
  );

-- ============================================================
-- 2. attachments: add clinic_id (table is empty in production today,
--    so this is a safe direct NOT NULL add with no backfill needed) and
--    a matching policy, consistent with every other clinic-scoped table
--    in the app instead of a join-through-patients policy.
-- ============================================================

alter table public.attachments
  add column if not exists clinic_id uuid references public.clinics(id);

do $$
begin
  if not exists (select 1 from public.attachments where clinic_id is null) then
    alter table public.attachments alter column clinic_id set not null;
  end if;
end $$;

alter table public.attachments enable row level security;

drop policy if exists "attachments_all_own_clinic" on public.attachments;
create policy "attachments_all_own_clinic"
  on public.attachments for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = attachments.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = attachments.clinic_id
    )
  );

-- ============================================================
-- 3. patient-files storage bucket: scope by the uploaded object's path.
--    Uploads are stored as `${patientId}/${fileName}` (see
--    services/storage.ts#uploadPatientFile), so the first path segment
--    is a patient id - join through patients to that patient's clinic
--    rather than changing the existing path convention/app code.
-- ============================================================

drop policy if exists "patient_files_all_own_clinic" on storage.objects;
create policy "patient_files_all_own_clinic"
  on storage.objects for all
  using (
    bucket_id = 'patient-files'
    and exists (
      select 1 from public.patients p
      join public.clinic_users cu on cu.clinic_id = p.clinic_id
      where p.id::text = (storage.foldername(name))[1]
        and cu.auth_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'patient-files'
    and exists (
      select 1 from public.patients p
      join public.clinic_users cu on cu.clinic_id = p.clinic_id
      where p.id::text = (storage.foldername(name))[1]
        and cu.auth_user_id = auth.uid()
    )
  );
