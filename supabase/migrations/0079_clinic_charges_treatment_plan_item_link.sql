-- Phase G: gives every clinic_charges row an explicit, exact link back to
-- the treatment_plan_items row that created it - closing the identity gap
-- Phase F found. Before this, the only relationship between the two
-- tables was the reverse pointer treatment_plan_items.charge_id
-- (0006_treatment_plans.sql); clinic_charges itself had no column at all
-- recording which Treatment (if any) produced it, so a canonical charge
-- and a legacy Tooth Details charge (services/patientTeeth.ts#saveTooth())
-- were structurally indistinguishable once created - Phase F proved this
-- let the same clinical work be billed twice with nothing to catch it.
--
-- Nullable by design: a legacy charge has no treatment_plan_item at all,
-- and that is a legitimate, permanent state - not every clinic_charges
-- row must eventually get one.
--
-- on delete set null (not cascade): deleting a treatment_plan_item must
-- never delete or orphan a clinic_charges/clinic_invoice_items row - that
-- would destroy financial history. This mirrors the existing precedent
-- exactly: treatment_plan_items.charge_id already uses
-- "on delete set null" in the opposite direction (0006) for the same
-- reason. If a treatment_plan_item is ever deleted while its charge still
-- exists, the charge and any invoice built from it are left completely
-- intact - only the identity link is cleared, the same graceful
-- degradation to "unlinked" a legacy charge already represents.
--
-- No RLS changes: clinic_charges' four existing policies (0060) are all
-- clinic_users-membership checks scoped only to clinic_charges.clinic_id -
-- entirely independent of this new column, so adding it changes no
-- authorization behavior. Confirmed by re-reading 0060 directly rather
-- than assuming.

alter table public.clinic_charges
  add column if not exists treatment_plan_item_id uuid
    references public.treatment_plan_items(id) on delete set null;

-- Queried during duplicate-billing detection, Treatment billing, and the
-- Billing page's canonical/legacy distinction (all read "does this charge
-- belong to treatment X / any treatment at all") - a plain non-unique
-- index (not unique: a treatment_plan_item is expected to have at most
-- one active charge in practice via the unbilled-only filter already in
-- billTreatmentPlanItems(), but nothing here needs to enforce that at the
-- constraint level, since the true invariant is enforced by checking
-- treatment_plan_items.charge_id before ever creating a new charge - see
-- services/treatmentPlans.ts).
create index if not exists idx_clinic_charges_treatment_plan_item_id
  on public.clinic_charges(treatment_plan_item_id);

/* ============================================================ */
/* Backfill - ONLY the exact, already-recorded relationship      */
/* ============================================================ */
-- Deliberately NOT inferred from patient_id/tooth_number/treatment_name/
-- amount - Phase F demonstrated those can coincide across genuinely
-- independent clinical events (a legacy charge and an unrelated canonical
-- Treatment for the same tooth). The only trustworthy signal is the exact
-- relationship treatment_plan_items.charge_id already recorded at
-- creation time (services/treatmentPlans.ts#billTreatmentPlanItems).

do $$
declare
  v_before_linked_items integer;
  v_before_already_set integer;
begin
  select count(*) into v_before_linked_items
  from public.treatment_plan_items
  where charge_id is not null;

  select count(*) into v_before_already_set
  from public.clinic_charges
  where treatment_plan_item_id is not null;

  raise notice
    'clinic_charges backfill (before): % treatment_plan_items row(s) have a charge_id; % clinic_charges row(s) already have treatment_plan_item_id set (expected 0 on first run).',
    v_before_linked_items, v_before_already_set;
end $$;

-- Audit: report (never repair) any charge_id shared by more than one
-- treatment_plan_items row - not expected given how charges are created
-- (one INSERT per unbilled item, see billTreatmentPlanItems), but checked
-- rather than assumed.
do $$
declare
  v_shared_charge_count integer;
begin
  select count(*) into v_shared_charge_count
  from (
    select charge_id
    from public.treatment_plan_items
    where charge_id is not null
    group by charge_id
    having count(*) > 1
  ) dupes;

  if v_shared_charge_count > 0 then
    raise notice
      'clinic_charges backfill audit: % charge_id value(s) are referenced by more than one treatment_plan_items row - each such clinic_charges row will be linked to only ONE of them by this migration. This was not expected; investigate separately if this count is nonzero.',
      v_shared_charge_count;
  else
    raise notice 'clinic_charges backfill audit: no charge_id is shared by more than one treatment_plan_items row, as expected.';
  end if;
end $$;

do $$
declare
  v_linked_count integer;
begin
  update public.clinic_charges cc
  set treatment_plan_item_id = tpi.id
  from public.treatment_plan_items tpi
  where tpi.charge_id = cc.id
    and cc.treatment_plan_item_id is distinct from tpi.id;

  get diagnostics v_linked_count = row_count;

  raise notice
    'clinic_charges backfill: % row(s) linked to their originating treatment_plan_items via the exact charge_id relationship. Every other clinic_charges row (legacy Tooth Details charges, and any other charge with no treatment_plan_items.charge_id pointing to it) was left with treatment_plan_item_id = null - this is the correct, permanent state for a legacy charge, not an incomplete backfill.',
    v_linked_count;
end $$;

/* ============================================================ */
/* Self-verification                                              */
/* ============================================================ */
-- This is an exact 1:1 relationship, not an inference - there must be
-- zero exceptions. A mismatch here would mean a real bug in the backfill
-- above, not a data-quality issue to silently tolerate.

do $$
declare
  v_mismatch_count integer;
  v_after_linked integer;
begin
  select count(*) into v_mismatch_count
  from public.treatment_plan_items tpi
  join public.clinic_charges cc on cc.id = tpi.charge_id
  where cc.treatment_plan_item_id is distinct from tpi.id;

  if v_mismatch_count <> 0 then
    raise exception
      'clinic_charges backfill incomplete: % treatment_plan_items row(s) have a charge_id whose clinic_charges.treatment_plan_item_id does not point back correctly.',
      v_mismatch_count;
  end if;

  select count(*) into v_after_linked
  from public.clinic_charges
  where treatment_plan_item_id is not null;

  raise notice
    'clinic_charges backfill verified: every treatment_plan_items.charge_id relationship is correctly mirrored. % clinic_charges row(s) now have treatment_plan_item_id set (canonical); all others remain null (legacy or otherwise unlinked).',
    v_after_linked;
end $$;
