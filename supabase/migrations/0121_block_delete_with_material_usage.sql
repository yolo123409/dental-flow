-- Full-app audit fix H3 (High): deleting a treatment plan item (or a
-- whole plan, which cascades to its items via treatment_plan_items.
-- treatment_plan_id on delete cascade, migration 0006) that has logged
-- treatment_material_usage cascades that usage away too (migration 0088:
-- treatment_material_usage.treatment_plan_item_id on delete cascade) -
-- permanently destroying the only path (update_treatment_material_
-- quantity) that could reverse the stock decrement and ledger COGS entry
-- it already posted. The linked clinic_charges row survives intact
-- (charge_id/deposit_charge_id are on delete set null, migrations
-- 0006/0079/0112 - deliberate, unaffected by this fix), but real
-- inventory/COGS history disappears with no warning.
--
-- THE FIX: a BEFORE DELETE trigger blocks the delete outright (a row-level
-- trigger fires for a cascaded delete too, so this also protects a
-- whole-plan delete) when the item has any logged material usage,
-- directing the user to zero it out first via the existing, correct
-- update_treatment_material_quantity() path. Scoped specifically to
-- material-usage presence, not invoice status - an item with no logged
-- materials remains freely deletable exactly as today.
--
-- Safe to re-run: create or replace function, drop trigger if exists +
-- create.

create or replace function public._trigger_block_delete_with_material_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.treatment_material_usage
    where treatment_plan_item_id = OLD.id
  ) then
    raise exception 'This treatment has materials logged against it - remove or zero out the logged materials first, or the stock/cost history they represent would be lost.';
  end if;

  return OLD;
end;
$$;

drop trigger if exists trg_block_delete_with_material_usage on public.treatment_plan_items;
create trigger trg_block_delete_with_material_usage
  before delete on public.treatment_plan_items
  for each row execute function public._trigger_block_delete_with_material_usage();
