-- Fixes a genuine defect in 0072_treatment_teeth.sql, discovered while
-- building Phase C (the odontogram integration): treatment_teeth's
-- tooth_number CHECK used a plain "between 1 and 32" bound, copied from
-- patient_diagnosis_codes/patient_procedure_codes (0054_clinical_coding.sql).
-- That bound is NOT the real FDI numbering the odontogram and
-- patient_teeth actually use (11-18, 21-28, 31-38, 41-48) - it silently
-- accepts only quadrants 1-2 plus teeth 31/32, and REJECTS every other
-- lower-arch tooth (33-38, 41-48), which is most of the lower arch. A
-- dentist selecting tooth 36 or 48 on the odontogram and adding a
-- treatment would have been rejected by this constraint.
--
-- Per project convention, the original migration is not edited in place -
-- this replaces its CHECK constraint with the correct FDI predicate.
-- "treatment_teeth_tooth_number_check" is the name Postgres auto-assigned
-- to the original unnamed column-level CHECK (table_column_check).
--
-- Deliberately NOT touched here: patient_diagnosis_codes and
-- patient_procedure_codes (0054) have the exact same "1-32" bug, but
-- are a separate, unrelated subsystem (ICD-10/CDT/CPT coding) that
-- Phase C does not integrate with - flagged as a known follow-up, not
-- fixed in this migration.

alter table public.treatment_teeth
  drop constraint if exists treatment_teeth_tooth_number_check;

alter table public.treatment_teeth
  add constraint treatment_teeth_tooth_number_check
  check (
    (tooth_number between 11 and 18)
    or (tooth_number between 21 and 28)
    or (tooth_number between 31 and 38)
    or (tooth_number between 41 and 48)
  );
