-- Treatment Profitability - configurable direct-cost field.
--
-- Adds a nullable direct_cost column to the existing treatment price
-- catalog (clinic_treatments). Nullable is intentional and load-bearing:
-- null means "not configured" - the application must never invent or
-- assume a cost when this is null (see services/treatmentProfitability.ts).
--
-- clinic_treatments itself predates tracked migration history (confirmed by
-- grep - no CREATE TABLE for it anywhere in supabase/migrations), same
-- situation as clinic_invoices/clinic_charges/patients/clinics noted in
-- earlier migrations' comments. Its existing RLS (which already correctly
-- lets clinic staff view/create/update/delete their own clinic's rows
-- today, via the treatments page) is untouched here - this only adds a
-- column, which needs no new policy since Postgres RLS is row-level, not
-- column-level.
--
-- Safe to re-run: add column if not exists + drop/add constraint.

alter table public.clinic_treatments
  add column if not exists direct_cost numeric(10, 2);

alter table public.clinic_treatments
  drop constraint if exists clinic_treatments_direct_cost_non_negative;

alter table public.clinic_treatments
  add constraint clinic_treatments_direct_cost_non_negative
  check (direct_cost is null or direct_cost >= 0);
