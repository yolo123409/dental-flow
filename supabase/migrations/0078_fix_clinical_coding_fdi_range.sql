-- Phase D, section 17: fixes the same "1-32" FDI defect 0074 already fixed
-- for treatment_teeth, this time in patient_diagnosis_codes.tooth_number
-- and patient_procedure_codes.tooth_number (0054_clinical_coding.sql) -
-- flagged as an out-of-scope follow-up in both the Phase C report and
-- 0074's own comment. Real FDI codes are 11-18, 21-28, 31-38, 41-48; a
-- plain 1-32 bound wrongly accepts the "gap" values (19, 20, 29, 30, 39,
-- 40, 49) and wrongly rejects every FDI code above 32 (most of the lower
-- arch: 33-38, 41-48).
--
-- Per section 17's explicit instruction, existing data is inspected
-- before the constraint changes, and nothing is blindly deleted or
-- rewritten: patient_diagnosis_codes/patient_procedure_codes are actual
-- clinical history (a patient's recorded diagnoses and performed
-- procedures), a materially higher bar than treatment_teeth's purely
-- relational rows (which 0075 was able to safely delete and rebuild from
-- the still-intact treatment_plan_items source of truth - there is no
-- equivalent safe source to rebuild a diagnosis/procedure code from).
--
-- So this migration:
--   1. Reports (via RAISE NOTICE, never modifies) how many legacy rows in
--      each table have a tooth_number outside every real FDI range.
--   2. Replaces the "1-32" CHECK constraint with the correct FDI ranges,
--      added as NOT VALID - every NEW or UPDATED row is fully enforced
--      from this point on, while any pre-existing legacy row (reported in
--      step 1) is left completely untouched rather than blocking this
--      migration or being silently deleted/coerced.
--   3. Attempts to VALIDATE both constraints immediately: if there is no
--      legacy bad data, this succeeds and the constraint becomes fully
--      enforced (including retroactively); if legacy bad data does exist,
--      the failure is caught and reported rather than aborting the whole
--      migration, and the constraint simply stays NOT VALID until that
--      specific legacy data is investigated separately (out of scope
--      here - this migration's job is closing the gap for new data, not
--      auditing old data it cannot safely judge on its own).
--
-- Client-side: no equivalent "1-32" bound exists in the TypeScript layer
-- for these two tables - every current write path supplies a tooth
-- number that already came from the odontogram (ClinicalCodePicker via
-- ToothDetails/TreatmentForm) or from TreatmentItemModal, which already
-- validates with isValidTooth() (see components/patients/dental/
-- toothSelection.ts) as of Phase C/D. This migration is therefore the
-- complete fix, not just the database half of one.

do $$
declare
  v_diag_invalid integer;
  v_proc_invalid integer;
begin
  select count(*) into v_diag_invalid
  from public.patient_diagnosis_codes
  where tooth_number is not null
    and not (
      (tooth_number between 11 and 18)
      or (tooth_number between 21 and 28)
      or (tooth_number between 31 and 38)
      or (tooth_number between 41 and 48)
    );

  select count(*) into v_proc_invalid
  from public.patient_procedure_codes
  where tooth_number is not null
    and not (
      (tooth_number between 11 and 18)
      or (tooth_number between 21 and 28)
      or (tooth_number between 31 and 38)
      or (tooth_number between 41 and 48)
    );

  raise notice
    'FDI audit: % legacy patient_diagnosis_codes row(s) and % legacy patient_procedure_codes row(s) have a tooth_number outside every real FDI range. None were modified or deleted by this migration - see the NOT VALID constraint notes below for what this means going forward.',
    v_diag_invalid, v_proc_invalid;
end $$;

alter table public.patient_diagnosis_codes
  drop constraint if exists patient_diagnosis_codes_tooth_number_check;

alter table public.patient_diagnosis_codes
  add constraint patient_diagnosis_codes_tooth_number_check
  check (
    tooth_number is null or (
      (tooth_number between 11 and 18)
      or (tooth_number between 21 and 28)
      or (tooth_number between 31 and 38)
      or (tooth_number between 41 and 48)
    )
  ) not valid;

alter table public.patient_procedure_codes
  drop constraint if exists patient_procedure_codes_tooth_number_check;

alter table public.patient_procedure_codes
  add constraint patient_procedure_codes_tooth_number_check
  check (
    tooth_number is null or (
      (tooth_number between 11 and 18)
      or (tooth_number between 21 and 28)
      or (tooth_number between 31 and 38)
      or (tooth_number between 41 and 48)
    )
  ) not valid;

do $$
begin
  begin
    alter table public.patient_diagnosis_codes
      validate constraint patient_diagnosis_codes_tooth_number_check;

    raise notice 'patient_diagnosis_codes_tooth_number_check fully validated - no legacy rows violate it.';
  exception when check_violation then
    raise notice 'patient_diagnosis_codes_tooth_number_check left NOT VALID: legacy row(s) violate it (see the audit above). New/updated rows are still fully enforced.';
  end;

  begin
    alter table public.patient_procedure_codes
      validate constraint patient_procedure_codes_tooth_number_check;

    raise notice 'patient_procedure_codes_tooth_number_check fully validated - no legacy rows violate it.';
  exception when check_violation then
    raise notice 'patient_procedure_codes_tooth_number_check left NOT VALID: legacy row(s) violate it (see the audit above). New/updated rows are still fully enforced.';
  end;
end $$;
