-- Corrective migration - a real legacy data-quality gap found in
-- treatment_teeth after the Phase A backfill (0072_treatment_teeth.sql)
-- was applied: at least one pre-existing treatment_plan_items row had
-- tooth_number = 4, which the ORIGINAL Phase A backfill filter
-- (`between 1 and 32`, the same wrong bound 0074 later fixed for new
-- writes) let through into treatment_teeth even though it is not a real
-- FDI tooth number.
--
-- 4 is not a typo-able FDI code and has no safe, non-speculative FDI
-- mapping - it long predates treatment_teeth and even predates any FDI
-- validation on treatment_plan_items.tooth_number itself. Rather than
-- guess what the dentist meant, this migration removes it from the new
-- FDI relationship only. It deliberately does NOT touch the historical
-- clinical/billing record that produced it:
--   - treatment_plan_items.tooth_number is NOT changed (stays 4) -
--     that column is untouched compatibility data, not FDI-validated.
--   - The treatment_plan_items row, its treatment_plan, and any
--     clinic_charges/clinic_invoices/clinic_invoice_items derived from
--     it are completely untouched.
--
-- This migration is idempotent and safe to apply regardless of whether
-- 0074_fix_treatment_teeth_fdi_range.sql already ran on this database:
-- the DELETE below is a no-op if the bad rows are already gone, and the
-- constraint is dropped and re-added unconditionally so the end state is
-- correct either way. It does not edit 0072 or 0074 in place.

/* ============================================================ */
/* 1. Remove treatment_teeth rows outside every valid FDI range  */
/* ============================================================ */
-- Scoped purely by value, not by id - catches this specific known bad
-- row (tooth_number = 4) and any other row like it, without needing to
-- enumerate ids.

do $$
declare
  v_deleted_count integer;
begin
  delete from public.treatment_teeth
  where not (
    (tooth_number between 11 and 18)
    or (tooth_number between 21 and 28)
    or (tooth_number between 31 and 38)
    or (tooth_number between 41 and 48)
  );

  get diagnostics v_deleted_count = row_count;

  raise notice
    'treatment_teeth cleanup: removed % row(s) with a tooth_number outside every valid FDI range. treatment_plan_items and all financial records were NOT touched.',
    v_deleted_count;
end $$;

/* ============================================================ */
/* 2. Re-apply the correct FDI constraint (idempotent)           */
/* ============================================================ */

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

/* ============================================================ */
/* 3. Self-verification                                          */
/* ============================================================ */

do $$
declare
  v_invalid_count integer;
begin
  select count(*) into v_invalid_count
  from public.treatment_teeth
  where not (
    (tooth_number between 11 and 18)
    or (tooth_number between 21 and 28)
    or (tooth_number between 31 and 38)
    or (tooth_number between 41 and 48)
  );

  if v_invalid_count <> 0 then
    raise exception
      'treatment_teeth cleanup failed: % row(s) still outside every valid FDI range after cleanup.',
      v_invalid_count;
  end if;

  raise notice 'treatment_teeth cleanup verified: 0 rows remain outside the valid FDI ranges.';
end $$;

-- Historical record check: confirms the source treatment_plan_items row
-- (tooth_number = 4, "root canal") was left completely untouched by this
-- migration, exactly as intended.
do $$
declare
  v_procedure text;
  v_tooth_number integer;
begin
  select procedure, tooth_number
    into v_procedure, v_tooth_number
  from public.treatment_plan_items
  where id = 'aa6a25cb-4d93-4762-a064-f98e1f643f6f';

  if v_procedure is null then
    raise notice 'treatment_plan_items row aa6a25cb-4d93-4762-a064-f98e1f643f6f was not found - nothing to verify (may not exist on this database).';
  elsif v_procedure <> 'root canal' or v_tooth_number <> 4 then
    raise exception
      'treatment_plan_items row aa6a25cb-4d93-4762-a064-f98e1f643f6f changed unexpectedly: procedure=%, tooth_number=% (expected "root canal", 4)',
      v_procedure, v_tooth_number;
  else
    raise notice 'Historical record verified unchanged: treatment_plan_items aa6a25cb-4d93-4762-a064-f98e1f643f6f still has procedure="root canal", tooth_number=4.';
  end if;
end $$;
