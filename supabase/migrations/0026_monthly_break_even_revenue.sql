-- ============================================================
-- Monthly Break-Even Revenue V1.
--
-- A single nullable column on the existing clinic_settings table -
-- mirrors the exact pattern 0009_invoice_taxation.sql already used to add
-- configurable tax fields (alter table + a range-check constraint, no new
-- table, no RLS changes). NULL means "not configured yet" and must never
-- be treated as 0 by application code. Existing clinics get NULL
-- automatically - no backfill, no forced onboarding.
--
-- No RLS changes: clinic_settings already has a clinic-scoped SELECT
-- policy and an UPDATE policy that every existing Settings field (tax
-- rate, invoice prefix, etc.) already relies on - this column is exposed
-- through exactly the same policy, so Clinic A already cannot read/write
-- Clinic B's row, same as every other clinic_settings column.
-- ============================================================

alter table public.clinic_settings
  add column if not exists monthly_break_even_revenue numeric(12,2);

alter table public.clinic_settings
  drop constraint if exists clinic_settings_break_even_non_negative;
alter table public.clinic_settings
  add constraint clinic_settings_break_even_non_negative
  check (monthly_break_even_revenue is null or monthly_break_even_revenue >= 0);
