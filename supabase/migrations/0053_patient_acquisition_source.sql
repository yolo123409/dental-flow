-- Patient Acquisition & Referral Tracking
--
-- Adds three new nullable columns to the existing `patients` table so
-- future patient-acquisition analytics can use real, explicitly-recorded
-- data instead of always showing "Not available" (confirmed in the prior
-- Visit & Patient Acquisition Analytics round - this schema has never
-- captured walk-in/referral/acquisition-source information anywhere;
-- verified again immediately before writing this migration via a live,
-- read-only column dump of `patients` - none of the three columns below
-- exist yet).
--
-- Deliberately plain `text` (not a Postgres enum type) so new sources can
-- be added later with a single CHECK-constraint update rather than an
-- ALTER TYPE migration. CHECK constraints explicitly allow NULL to pass
-- (`col is null or col in (...)`) so every existing patient row - which
-- has no value for any of these new columns - remains valid without
-- being touched. This migration only adds columns and constraints; it
-- contains no UPDATE statement and writes to zero existing rows.
--
-- RLS: patients' SELECT/UPDATE/DELETE policies are not tracked in any
-- migration (see 0040's own note - they live outside version control,
-- like clinics/clinic_users) but were independently confirmed live to
-- correctly scope by clinic_id, with no cross-clinic leak. Postgres RLS
-- is row-level, not column-level, so these new columns automatically
-- inherit the exact same protection as every other patients column -
-- no policy changes are needed or made here.
--
-- Safe to re-run: every statement is idempotent (add column/constraint
-- if not exists, or drop-if-exists + add). No CASCADE anywhere.

alter table public.patients
  add column if not exists acquisition_source text,
  add column if not exists referral_source text,
  add column if not exists referral_source_name text;

alter table public.patients
  drop constraint if exists patients_acquisition_source_check;

alter table public.patients
  add constraint patients_acquisition_source_check
  check (
    acquisition_source is null or acquisition_source in (
      'Walk-in', 'Referral', 'Google', 'Social Media', 'Website',
      'Phone', 'Existing Patient', 'Other', 'Unknown'
    )
  );

alter table public.patients
  drop constraint if exists patients_referral_source_check;

alter table public.patients
  add constraint patients_referral_source_check
  check (
    referral_source is null or referral_source in (
      'Existing Patient', 'Dentist', 'Doctor', 'Clinic',
      'Friend/Family', 'Employer', 'Other'
    )
  );
