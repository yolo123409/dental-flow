-- Critical Safety Closure (Audit II, Critical #2): un-cancelling a
-- treatment plan item left its linked charge permanently stuck at
-- 'Cancelled', even after the item became Planned/In Progress/Completed
-- again - the clinic silently loses the ability to ever bill for it,
-- since services/billing.ts's pending-charges query filters strictly on
-- status = 'Pending'.
--
-- ROOT CAUSE: migration 0119's trigger only handled entry INTO Cancelled
-- (OLD.status <> 'Cancelled' -> NEW.status = 'Cancelled'), never the
-- reverse. treatment_plan_items.status is otherwise freely editable in
-- both directions in the UI (TreatmentItemModal's Status <select> has all
-- four options always enabled) - the product's own intent is clearly
-- "cancellation is reversible, this is a plan, plans change." This
-- restores that symmetry for the linked charge.
--
-- Still never touches an already-'Invoiced' charge (real financial
-- history) - a charge can only ever reach 'Invoiced' by first being
-- 'Pending', so restoring Cancelled -> Pending here can't create a path
-- to un-cancel an already-billed item's charge.
--
-- Safe to re-run: create or replace function, drop trigger if exists +
-- create (same trigger name/table as 0119, no new objects).

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
    elsif OLD.status = 'Cancelled' and NEW.status is distinct from 'Cancelled' then
      update public.clinic_charges
      set status = 'Pending'
      where id in (NEW.charge_id, NEW.deposit_charge_id)
        and status = 'Cancelled';
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
