-- Full-app audit fix C6 (Critical): cancelling a treatment (or deleting
-- its plan item outright) never cancelled its already-staged Pending
-- clinic_charges row. Every billable treatment gets a Pending charge the
-- instant it's created (migration 0080), independent of whether it's
-- ever billed - so a cancelled treatment's charge just sits there, fully
-- visible and selectable on the Billing Control Center's "Ready to
-- Invoice" list (services/billing.ts#getPendingCharges filters strictly
-- on status = 'Pending', with no visibility into the linked treatment's
-- own status at all).
--
-- Confirmed before writing this: clinic_charges.status has no CHECK
-- constraint anywhere (only 'Pending'/'Invoiced' are ever used in
-- practice - services/billing.ts, services/treatmentPlans.ts,
-- migrations 0080/0109/0112), so adding a third value here is purely
-- additive. Confirmed treatment_plan_items has exactly one trigger today
-- (trg_guard_treatment_plan_item_role, migration 0097, a role guard only)
-- - nothing currently reacts to a status change or a delete, and neither
-- updateTreatmentItem() nor deleteTreatmentItem() (services/
-- treatmentPlans.ts) goes through a shared RPC, so an application-layer
-- fix would have to be duplicated in two places and would still miss any
-- other future write path. A trigger is the one place this can live once
-- and be correct regardless of caller.
--
-- Never touches an already-'Invoiced' charge - that's financial history,
-- untouched, the same rule this codebase applies everywhere else
-- (sync_treatment_charge_amount, void_invoice's charge-freeing, etc.).
-- Handles both the item's main charge_id and, if present, its
-- deposit_charge_id (migration 0112) - a split item being cancelled must
-- cancel whichever of the two halves is still Pending, not just one.
--
-- Safe to re-run: create or replace function, drop trigger if exists +
-- create.

create or replace function public._trigger_cancel_charges_on_treatment_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.status = 'Cancelled' and OLD.status is distinct from 'Cancelled' then
      update public.clinic_charges
      set status = 'Cancelled'
      where id in (OLD.charge_id, OLD.deposit_charge_id)
        and status = 'Pending';
    end if;

    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    update public.clinic_charges
    set status = 'Cancelled'
    where id in (OLD.charge_id, OLD.deposit_charge_id)
      and status = 'Pending';

    return OLD;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_cancel_charges_on_treatment_removal on public.treatment_plan_items;
create trigger trg_cancel_charges_on_treatment_removal
  after update or delete on public.treatment_plan_items
  for each row execute function public._trigger_cancel_charges_on_treatment_removal();
