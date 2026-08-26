-- FIN-2.5: Treatment Instance Profitability - integrity backstop only.
--
-- PHASE A/B FINDING (before writing this): the exact treatment-instance <->
-- billing-revenue relationship this phase needs ALREADY EXISTS and needs no
-- new table or column. treatment_plan_items.charge_id -> clinic_charges.id
-- (migration 0006, backfilled/linked by 0079/0080) already gives an exact,
-- unambiguous, per-instance link - never a name/patient/date match. And
-- clinic_charges.amount is ALREADY, by construction, the exact revenue
-- figure createInvoice() copies verbatim into clinic_invoice_items.
-- total_price for that charge (services/billing.ts: `unit_price:
-- charge.amount, total_price: charge.amount`) - nothing ever updates
-- clinic_charges.amount after it reaches 'Invoiced' status (confirmed: no
-- triggers on clinic_charges at all, and sync_treatment_charge_amount's own
-- migration 0080 comment states an Invoiced charge's amount "is left
-- completely untouched"). Verified against every existing Invoiced charge
-- in the live database before writing this: zero mismatches between
-- clinic_charges.amount and its resulting invoice line's total_price.
-- So no clinic_invoice_items schema change, no backfill, and no second
-- revenue relationship is introduced here - see
-- services/treatmentInstanceProfitability.ts for how this is read.
--
-- The one real, verified-live gap: clinic_charges.treatment_plan_item_id
-- (the reverse direction) has never been protected by a database-level
-- uniqueness constraint - only application logic (sync_treatment_charge_
-- amount only ever creates a new charge when treatment_plan_items.charge_id
-- is still null) has kept it 1:1 in practice. Two different charges both
-- pointing at the same treatment instance would let that treatment's
-- revenue be double-counted by the new per-instance profitability
-- calculation. Verified against live data before writing this migration:
-- zero existing duplicates, so this is safe to add without any cleanup.
--
-- Safe to re-run: create index if not exists.

create unique index if not exists uq_clinic_charges_treatment_plan_item_id
  on public.clinic_charges (treatment_plan_item_id)
  where treatment_plan_item_id is not null;
