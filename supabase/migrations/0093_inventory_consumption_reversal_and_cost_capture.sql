-- FIN-3.4: two small, targeted fixes to the inventory-consumption ledger
-- path - neither changes the clinic's costing METHODOLOGY (still "Last
-- Cost": clinic_inventory_items.cost_per_unit, overwritten on every GRN
-- receipt, used identically by every consumption path - confirmed by this
-- phase's audit to already be internally consistent between valuation and
-- COGS). Both fixes close real, verified gaps in how that one methodology
-- is APPLIED, not what it is.
--
-- FIX 1 - _trigger_post_inventory_consumption_ledger() never reverses COGS
-- for a material-usage correction:
--
-- update_treatment_material_quantity() (migration 0088) already inserts a
-- correct, fully-costed Increase/'Consumption Reversal' movement when a
-- treatment's recorded material usage is reduced (stock physically comes
-- back, unit_cost set to the usage line's own weighted-average cost - see
-- that function's own header comment). But the ledger trigger's guard was
-- `movement_type <> 'Decrease'`, which silently excludes EVERY Increase-
-- type movement, including this one - so the original Debit Supplies
-- Used / Credit Inventory posting from the consumption this reverses is
-- NEVER undone. COGS stays permanently overstated by the reversed amount
-- and Inventory stays permanently understated by the same amount, even
-- though the physical stock and the treatment_material_usage row both
-- correctly reflect the correction.
--
-- CONFIRMED VIA LIVE DATA (never guessed): zero 'Consumption Reversal'
-- movements exist anywhere in the database today - this code path has
-- never actually fired in production, so this fix changes no historical
-- dollar figure. It closes a real, verified defect before it can ever
-- produce a wrong number, rather than repairing one after the fact.
--
-- The fix adds exactly one more qualifying case to the trigger's guard -
-- Increase-type movements with reason 'Consumption Reversal' - and posts
-- the mirror image of a normal consumption entry (Debit Inventory / Credit
-- Supplies Used) using the movement's own already-captured unit_cost
-- (never a live re-lookup, matching how a normal consumption entry is
-- costed). 'Returned to Supplier' keeps its own existing AP-side
-- direction unchanged - this fix only adds the one new case that was
-- previously silently dropped.
--
-- FIX 2 - adjust_inventory_stock() never captures unit_cost on the
-- movements it creates, unlike add_treatment_material()/
-- update_treatment_material_quantity() (migration 0088), which both
-- explicitly stamp the item's cost_per_unit onto their movement row at
-- the moment of consumption. adjust_inventory_stock()'s movements
-- (RecordConsumptionModal / AdjustStockModal - the general, non-treatment
-- consumption/damage/expiry/correction path, which this phase's audit
-- confirms remains legitimate and is NOT being removed) instead leave
-- unit_cost null, relying on the ledger trigger's live coalesce() lookup
-- of cost_per_unit AT POSTING time. Today that produces an identical
-- dollar figure (the trigger fires in the same transaction as the
-- insert), but it leaves the movement row itself unable to durably answer
-- "what cost applied to this specific unit" - exactly the gap that left
-- one historical movement (found and documented in FIN-3.3, not touched
-- by this migration) permanently uncostable once its item's price moved
-- on. This fix makes adjust_inventory_stock() capture cost_per_unit onto
-- every movement it creates, matching the pattern already established by
-- the FIN-2 path - never a new cost SOURCE, never a different amount than
-- what would already be resolved today, just captured durably instead of
-- left to a live lookup.
--
-- Neither fix touches any existing row, any RLS policy, or grants any new
-- access - both are create-or-replace over already-existing, already-
-- granted functions.

/* ============================================================ */
/* Fix 1: reverse COGS correctly for a material-usage correction */
/* ============================================================ */

create or replace function public._trigger_post_inventory_consumption_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_unit_cost numeric;
  v_total numeric;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_transaction_type text;
begin
  if not (
    (NEW.movement_type = 'Decrease' and NEW.reason in ('Used', 'Damaged', 'Expired', 'Returned to Supplier'))
    or (NEW.movement_type = 'Increase' and NEW.reason = 'Consumption Reversal')
  ) then
    return NEW;
  end if;

  begin
    v_unit_cost := coalesce(
      NEW.unit_cost,
      (select ii.cost_per_unit from public.clinic_inventory_items ii where ii.id = NEW.inventory_item_id)
    );

    v_total := abs(NEW.quantity_change) * coalesce(v_unit_cost, 0);

    if v_total <= 0 then
      return NEW;
    end if;

    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    if NEW.reason = 'Returned to Supplier' then
      v_debit_account_id := v_settings.accounts_payable_account_id;
      v_credit_account_id := v_settings.inventory_account_id;
      v_transaction_type := 'InventoryReturn';
    elsif NEW.reason = 'Consumption Reversal' then
      -- Mirror image of the normal consumption entry below: stock is
      -- physically coming back (Debit Inventory) and the COGS this
      -- reverses is un-recognized (Credit Supplies Used).
      v_debit_account_id := v_settings.inventory_account_id;
      v_credit_account_id := v_settings.supplies_used_account_id;
      v_transaction_type := 'InventoryConsumption';
    else
      v_debit_account_id := v_settings.supplies_used_account_id;
      v_credit_account_id := v_settings.inventory_account_id;
      v_transaction_type := 'InventoryConsumption';
    end if;

    if v_debit_account_id is null or v_credit_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'inventory_movement', NEW.id, 'Inventory, Supplies Used, or Accounts Payable account is not configured.');
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.created_at::date, v_transaction_type, 'inventory_movement', NEW.id,
      NEW.reason || ': ' || abs(NEW.quantity_change) || ' units', coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_debit_account_id, 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_id', v_credit_account_id, 'debit', 0, 'credit', v_total)
      ),
      NEW.patient_id, NEW.supplier_id, NEW.created_by, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'inventory_movement', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

/* ============================================================ */
/* Fix 2: durably capture unit_cost on every adjust_inventory_stock */
/*         movement, matching the FIN-2 path's existing pattern     */
/* ============================================================ */

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_delta numeric,
  p_reason text,
  p_notes text default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_supplier_id uuid default null,
  p_patient_id uuid default null,
  p_treatment_id uuid default null,
  p_reference text default null
)
returns clinic_inventory_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_before numeric;
  v_after numeric;
  v_cost_per_unit numeric;
  v_item public.clinic_inventory_items;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_delta = 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.clinic_inventory_items ii on ii.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and ii.id = p_item_id;

  if v_clinic_id is null then
    raise exception 'Material not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to adjust stock';
  end if;

  if p_reason not in (
    'Restock', 'Used', 'Damaged', 'Expired',
    'Correction', 'Initial Stock', 'Returned to Supplier', 'Other'
  ) then
    raise exception 'Invalid movement reason';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.clinic_suppliers s
    where s.id = p_supplier_id and s.clinic_id = v_clinic_id
  ) then
    raise exception 'Supplier not found for this clinic';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.clinic_id = v_clinic_id
  ) then
    raise exception 'Patient not found for this clinic';
  end if;

  if p_treatment_id is not null and not exists (
    select 1 from public.clinic_treatments t
    where t.id = p_treatment_id and t.clinic_id = v_clinic_id
  ) then
    raise exception 'Treatment not found for this clinic';
  end if;

  select quantity, cost_per_unit into v_before, v_cost_per_unit
  from public.clinic_inventory_items
  where id = p_item_id and clinic_id = v_clinic_id
  for update;

  v_after := v_before + p_delta;

  if v_after < 0 then
    raise exception 'Cannot remove more than the current stock (% available).', v_before;
  end if;

  update public.clinic_inventory_items
  set quantity = v_after, updated_at = now()
  where id = p_item_id and clinic_id = v_clinic_id
  returning * into v_item;

  insert into public.clinic_inventory_movements (
    clinic_id, inventory_item_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, notes, created_by,
    batch_number, expiry_date, supplier_id, patient_id, treatment_id, reference,
    unit_cost
  )
  values (
    v_clinic_id, p_item_id, case when p_delta > 0 then 'Increase' else 'Decrease' end, p_delta,
    v_before, v_after, p_reason, nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    nullif(trim(coalesce(p_batch_number, '')), ''), p_expiry_date, p_supplier_id, p_patient_id, p_treatment_id,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_cost_per_unit
  );

  return v_item;
end;
$function$;
