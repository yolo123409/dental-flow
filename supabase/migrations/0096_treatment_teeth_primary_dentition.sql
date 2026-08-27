-- FIN-3.7: primary dentition charting already works (patient_teeth has no
-- tooth_number CHECK at all - confirmed live, not assumed), but the
-- canonical Treatment Plan Item -> Charge -> Invoice path is blocked one
-- table downstream: treatment_teeth (the multi-tooth link every Treatment
-- creation path writes through - create_treatment_with_teeth/
-- update_treatment_teeth, migrations 0073/0076/0077) still only accepts
-- permanent FDI numbers (11-48, fixed for the WRONG "1-32" bound by
-- migration 0074, but never widened to include primary teeth at all).
--
-- CONFIRMED LIVE before writing this migration: calling
-- create_treatment_with_teeth(..., ARRAY[55], ...) - tooth 55, a real
-- primary FDI number the odontogram already lets a dentist select and
-- chart - fails with "violates check constraint
-- treatment_teeth_tooth_number_check". clinic_charges.tooth_number and
-- treatment_plan_items.tooth_number (the legacy single-tooth columns) and
-- every downstream table (clinic_invoices, treatment_material_usage,
-- clinic_ledger_*) carry no tooth-range constraint at all and never
-- reference FDI ranges in any RPC body - treatment_teeth is the ONE
-- structural blocker in the whole Treatment Plan Item -> Charge ->
-- Invoice -> Materials -> COGS -> Ledger -> Treatment Profitability chain.
--
-- THE FIX: widen the CHECK to also accept the primary (deciduous) FDI
-- ranges - 51-55, 61-65, 71-75, 81-85 - using the EXACT same ranges
-- already established as canonical in the frontend
-- (components/patients/dental/toothSelection.ts's PRIMARY_UPPER_RIGHT/
-- PRIMARY_UPPER_LEFT/PRIMARY_LOWER_LEFT/PRIMARY_LOWER_RIGHT), not a
-- reinvented range. This keeps primary and permanent teeth structurally
-- isolated from each other (51-85 can never collide with 11-48 - FDI
-- notation guarantees this by construction) while accepting both.
--
-- DELIBERATELY NOT TOUCHED: patient_diagnosis_codes/patient_procedure_codes
-- (migration 0054) have the same permanent-only "11-48" style CHECK, but
-- migration 0074 already explicitly scoped them out as "a separate,
-- unrelated subsystem (ICD-10/CDT/CPT coding) that Phase C does not
-- integrate with" - confirmed still true (ToothDetails.tsx, the primary-
-- dentition UI this phase's brief traces, never references either
-- table). Following that same established precedent, not widening them
-- here either - they are not part of the Treatment Plan Item -> Invoice
-- chain this phase audits.
--
-- Safe to re-run: drop-then-recreate, matching every other constraint
-- migration in this folder. No data migration needed - every existing
-- treatment_teeth row is already a valid permanent tooth number (the old
-- constraint already enforced that), so widening the range can never
-- make an existing row newly invalid.

alter table public.treatment_teeth
  drop constraint if exists treatment_teeth_tooth_number_check;

alter table public.treatment_teeth
  add constraint treatment_teeth_tooth_number_check
  check (
    -- Permanent
    (tooth_number between 11 and 18)
    or (tooth_number between 21 and 28)
    or (tooth_number between 31 and 38)
    or (tooth_number between 41 and 48)
    -- Primary (deciduous)
    or (tooth_number between 51 and 55)
    or (tooth_number between 61 and 65)
    or (tooth_number between 71 and 75)
    or (tooth_number between 81 and 85)
  );
