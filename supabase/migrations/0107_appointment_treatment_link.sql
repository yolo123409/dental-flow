-- Appointment Completion -> Billing (Phase B/C): the missing relationship
-- the Phase A audit found - appointments has never referenced
-- treatment_plan_items at all (appointments.treatment is free text). This
-- adds the smallest link needed: an optional, many-to-one pointer from an
-- appointment to the single planned treatment it's for.
--
-- Nullable and NOT unique on purpose:
--   - Nullable: most appointments (checkups, consults, anything not tied
--     to a specific planned treatment) stay unlinked and behave exactly
--     as before - nothing here changes existing appointment behavior.
--   - Not unique: a multi-visit treatment (root canal across 3 visits)
--     needs SEVERAL appointments pointing at the SAME treatment_plan_item.
--     Uniqueness lives at the treatment-instance level instead (the
--     already-existing uq_clinic_charges_treatment_plan_item_id from
--     migration 0089), not here.
--
-- on delete set null (not cascade), matching the established precedent
-- for every other treatment_plan_item back-reference in this schema
-- (treatment_plan_items.charge_id, clinic_charges.treatment_plan_item_id):
-- deleting a treatment_plan_item must never delete or orphan an
-- appointment record.
--
-- No RLS change: appointments' existing policy (migration 0001) is a
-- plain clinic-membership check with zero column-level distinction, so
-- adding this column changes no authorization behavior.
--
-- Idempotent / safe to rerun: `if not exists` throughout.

alter table public.appointments
  add column if not exists treatment_plan_item_id uuid
    references public.treatment_plan_items(id) on delete set null;

create index if not exists idx_appointments_treatment_plan_item_id
  on public.appointments(treatment_plan_item_id);
