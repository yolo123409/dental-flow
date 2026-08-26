-- FIN-2: Treatment -> Inventory Consumption -> Actual COGS.
--
-- AUDIT FINDINGS (before writing this):
--   - The authoritative "actual treatment instance" is treatment_plan_items
--     (migration 0006) - one row per Treatment actually performed/planned
--     for one patient (via its parent treatment_plans.patient_id), distinct
--     from clinic_treatments (the price/name catalog a Treatment is merely
--     created FROM). clinic_inventory_movements already has a
--     `treatment_id` column (0042) but it references clinic_treatments (the
--     catalog) - that column is a DIFFERENT, pre-existing feature (tagging
--     an ad-hoc Inventory-page consumption with "which kind of treatment
--     used this"), not a treatment-instance link, and is left completely
--     untouched here. This migration adds a SEPARATE
--     `treatment_plan_item_id` column for the real per-instance link, per
--     the FIN-2 brief's explicit architectural rule never to conflate the
--     two.
--   - The existing inventory movement ledger (clinic_inventory_movements,
--     0012/0042) and its automatic ledger-posting trigger
--     (_trigger_post_inventory_consumption_ledger, 0043) are REUSED
--     verbatim for the debit/credit posting - no second COGS table, no
--     second ledger, no manual journal entry is created here. The trigger
--     is extended (create or replace, same function) with exactly one new
--     symmetric case (an Increase/'Consumption Reversal' movement posts the
--     exact opposite of a normal consumption entry), needed so reducing or
--     removing a previously-recorded material line correctly reverses its
--     COGS instead of leaving stock and the ledger out of sync - not a
--     parallel posting mechanism, the same one function gains one more
--     case.
--   - adjust_inventory_stock (0042) is NOT reused for treatment material
--     consumption: its `p_treatment_id` parameter is typed against
--     clinic_treatments (the catalog), and repurposing it would either
--     violate the architectural rule above or require changing its
--     existing, already-shipped meaning for the unrelated Inventory-page
--     "Record Consumption" flow. Two new RPCs below
--     (add_treatment_material/update_treatment_material_quantity) follow
--     its exact same atomic pattern (lock the item row FOR UPDATE, check
--     stock, update quantity, insert one movement row, all in one
--     transaction) instead.
--
-- IDEMPOTENCY / EDITING (sections 6, 12): treatment_material_usage holds
-- the CURRENT state (one row per material per treatment instance, unique
-- on (treatment_plan_item_id, inventory_item_id)) - it is not itself the
-- audit trail (clinic_inventory_movements remains that, unchanged).
-- Increasing a line's quantity posts one movement for only the delta
-- (never re-posts the whole new total); reducing or removing a line posts
-- a Consumption Reversal movement for only the removed delta. A quantity
-- edit therefore always nets to the physically correct total consumption,
-- never doubles it.
--
-- unit_cost on treatment_material_usage is a running WEIGHTED AVERAGE of
-- the row's own consumption events (recomputed only when quantity
-- increases, using the inventory item's cost_per_unit AT THE MOMENT of
-- that specific increase) - never the item's live cost_per_unit read at
-- display time. Each individual movement row's own unit_cost is an
-- immutable snapshot forever, exactly like every other movement in this
-- ledger (0042) - a later change to the item's cost_per_unit (e.g. a new
-- GRN) never rewrites a past movement or past ledger entry.
--
-- CANCELLATION (section 13): deliberately NO trigger reverses inventory
-- when a treatment_plan_items row is cancelled or deleted. Physical
-- material consumption is a real-world fact independent of the clinical
-- record's later status - clinic_inventory_movements/ledger entries always
-- survive (treatment_plan_item_id is ON DELETE SET NULL, mirroring
-- patient_id/supplier_id's existing precedent), only the CURRENT-STATE
-- treatment_material_usage summary row cascades away with its parent
-- Treatment. Reversing consumed stock is only ever an explicit user action
-- (editing the materials list down), never an automatic side effect of
-- status/deletion.
--
-- Safe to re-run: add column/create table if not exists, drop
-- policy/constraint/function + recreate, matching every other migration.

/* ============================================================ */
/* 1. clinic_inventory_movements: the real treatment-instance link */
/* ============================================================ */

alter table public.clinic_inventory_movements
  add column if not exists treatment_plan_item_id uuid
    references public.treatment_plan_items(id) on delete set null;

create index if not exists idx_clinic_inventory_movements_treatment_plan_item
  on public.clinic_inventory_movements(treatment_plan_item_id);

alter table public.clinic_inventory_movements
  drop constraint if exists clinic_inventory_movements_reason_check;

alter table public.clinic_inventory_movements
  add constraint clinic_inventory_movements_reason_check
  check (
    reason in (
      'Restock', 'Used', 'Damaged', 'Expired',
      'Correction', 'Initial Stock', 'Returned to Supplier',
      'Consumption Reversal', 'Other'
    )
  );

-- Same cross-tenant defense-in-depth as the existing supplier_id/patient_id/
-- treatment_id checks (0042) - only ever set by the SECURITY DEFINER RPCs
-- below in practice, but enforced at the RLS layer too for any direct
-- insert.
drop policy if exists "clinic_inventory_movements_insert_own_clinic" on public.clinic_inventory_movements;
create policy "clinic_inventory_movements_insert_own_clinic"
  on public.clinic_inventory_movements for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_movements.clinic_id
    )
    and (
      supplier_id is null
      or exists (
        select 1 from public.clinic_suppliers s
        where s.id = clinic_inventory_movements.supplier_id
          and s.clinic_id = clinic_inventory_movements.clinic_id
      )
    )
    and (
      patient_id is null
      or exists (
        select 1 from public.patients p
        where p.id = clinic_inventory_movements.patient_id
          and p.clinic_id = clinic_inventory_movements.clinic_id
      )
    )
    and (
      treatment_id is null
      or exists (
        select 1 from public.clinic_treatments t
        where t.id = clinic_inventory_movements.treatment_id
          and t.clinic_id = clinic_inventory_movements.clinic_id
      )
    )
    and (
      treatment_plan_item_id is null
      or exists (
        select 1 from public.treatment_plan_items tpi
        where tpi.id = clinic_inventory_movements.treatment_plan_item_id
          and tpi.clinic_id = clinic_inventory_movements.clinic_id
      )
    )
  );

/* ============================================================ */
/* 2. treatment_material_usage - current state, one row per      */
/*    (treatment instance, inventory item)                       */
/* ============================================================ */

create table if not exists public.treatment_material_usage (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  treatment_plan_item_id uuid not null references public.treatment_plan_items(id) on delete cascade,
  inventory_item_id uuid not null references public.clinic_inventory_items(id) on delete cascade,

  quantity numeric(10, 2) not null check (quantity > 0),
  unit_cost numeric(10, 2) not null check (unit_cost >= 0),

  created_by uuid references public.clinic_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (treatment_plan_item_id, inventory_item_id)
);

create index if not exists idx_treatment_material_usage_clinic_id
  on public.treatment_material_usage(clinic_id);
create index if not exists idx_treatment_material_usage_treatment_plan_item
  on public.treatment_material_usage(treatment_plan_item_id);
create index if not exists idx_treatment_material_usage_inventory_item
  on public.treatment_material_usage(inventory_item_id);

alter table public.treatment_material_usage enable row level security;

drop policy if exists "treatment_material_usage_select_own_clinic" on public.treatment_material_usage;
create policy "treatment_material_usage_select_own_clinic"
  on public.treatment_material_usage for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_material_usage.clinic_id
    )
  );

-- Deliberately NO insert/update/delete policy for regular clients - every
-- write happens through add_treatment_material/
-- update_treatment_material_quantity below (mirrors clinic_ledger_
-- transactions' own "writes only via security-definer functions" pattern,
-- 0043), so the atomic stock-check + movement + weighted-average-cost
-- invariant can never be bypassed by a direct client insert/update.

/* ============================================================ */
/* 3. Extend the existing consumption-ledger trigger with the    */
/*    symmetric reversal case - same function, one more branch.  */
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
  v_is_reversal boolean;
begin
  if NEW.movement_type = 'Decrease' and NEW.reason in ('Used', 'Damaged', 'Expired', 'Returned to Supplier') then
    v_is_reversal := false;
  elsif NEW.movement_type = 'Increase' and NEW.reason = 'Consumption Reversal' then
    v_is_reversal := true;
  else
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

    if v_is_reversal then
      v_debit_account_id := v_settings.inventory_account_id;
      v_credit_account_id := v_settings.supplies_used_account_id;
      v_transaction_type := 'Reversal';
    elsif NEW.reason = 'Returned to Supplier' then
      v_debit_account_id := v_settings.accounts_payable_account_id;
      v_credit_account_id := v_settings.inventory_account_id;
      v_transaction_type := 'InventoryReturn';
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
      case when v_is_reversal
        then 'Consumption reversal: ' || abs(NEW.quantity_change) || ' units returned to stock'
        else NEW.reason || ': ' || abs(NEW.quantity_change) || ' units'
      end,
      coalesce(v_currency, 'KES'),
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
/* 4. add_treatment_material - consume stock for a treatment      */
/*    instance, atomically (stock check + movement + usage row). */
/* ============================================================ */

create or replace function public.add_treatment_material(
  p_treatment_plan_item_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns public.treatment_material_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_patient_id uuid;
  v_before numeric;
  v_after numeric;
  v_current_cost numeric;
  v_existing public.treatment_material_usage;
  v_new_quantity numeric;
  v_new_unit_cost numeric;
  v_result public.treatment_material_usage;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.treatment_plan_items tpi on tpi.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and tpi.id = p_treatment_plan_item_id;

  if v_clinic_id is null then
    raise exception 'Treatment not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to record material consumption';
  end if;

  if not exists (
    select 1 from public.clinic_inventory_items ii
    where ii.id = p_inventory_item_id and ii.clinic_id = v_clinic_id
  ) then
    raise exception 'Material not found for this clinic';
  end if;

  select tp.patient_id into v_patient_id
  from public.treatment_plan_items tpi
  join public.treatment_plans tp on tp.id = tpi.treatment_plan_id
  where tpi.id = p_treatment_plan_item_id;

  select quantity, cost_per_unit into v_before, v_current_cost
  from public.clinic_inventory_items
  where id = p_inventory_item_id and clinic_id = v_clinic_id
  for update;

  v_after := v_before - p_quantity;

  if v_after < 0 then
    raise exception 'Cannot use more than the current stock (% available).', v_before;
  end if;

  update public.clinic_inventory_items
  set quantity = v_after, updated_at = now()
  where id = p_inventory_item_id and clinic_id = v_clinic_id;

  insert into public.clinic_inventory_movements (
    clinic_id, inventory_item_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, notes, created_by,
    unit_cost, patient_id, treatment_plan_item_id
  )
  values (
    v_clinic_id, p_inventory_item_id, 'Decrease', -p_quantity,
    v_before, v_after, 'Used', nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    v_current_cost, v_patient_id, p_treatment_plan_item_id
  );

  select * into v_existing
  from public.treatment_material_usage
  where treatment_plan_item_id = p_treatment_plan_item_id
    and inventory_item_id = p_inventory_item_id;

  if v_existing.id is null then
    insert into public.treatment_material_usage (
      clinic_id, treatment_plan_item_id, inventory_item_id, quantity, unit_cost, created_by
    )
    values (
      v_clinic_id, p_treatment_plan_item_id, p_inventory_item_id, p_quantity, v_current_cost, v_clinic_user_id
    )
    returning * into v_result;
  else
    v_new_quantity := v_existing.quantity + p_quantity;
    v_new_unit_cost := (v_existing.quantity * v_existing.unit_cost + p_quantity * v_current_cost) / v_new_quantity;

    update public.treatment_material_usage
    set quantity = v_new_quantity, unit_cost = v_new_unit_cost, updated_at = now()
    where id = v_existing.id
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

grant execute on function public.add_treatment_material(uuid, uuid, numeric, text) to authenticated;

/* ============================================================ */
/* 5. update_treatment_material_quantity - reconcile a line to a  */
/*    new total (increase = more consumption; decrease/zero =     */
/*    reverse the difference). Never re-posts the whole new total.*/
/* ============================================================ */

create or replace function public.update_treatment_material_quantity(
  p_usage_id uuid,
  p_new_quantity numeric
)
returns public.treatment_material_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_usage public.treatment_material_usage;
  v_patient_id uuid;
  v_delta numeric;
  v_before numeric;
  v_after numeric;
  v_current_cost numeric;
  v_new_unit_cost numeric;
  v_result public.treatment_material_usage;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Quantity cannot be negative.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.treatment_material_usage tmu on tmu.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and tmu.id = p_usage_id;

  if v_clinic_id is null then
    raise exception 'Material usage record not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to record material consumption';
  end if;

  select * into v_usage
  from public.treatment_material_usage
  where id = p_usage_id and clinic_id = v_clinic_id;

  v_delta := p_new_quantity - v_usage.quantity;

  if v_delta = 0 then
    return v_usage;
  end if;

  select tp.patient_id into v_patient_id
  from public.treatment_plan_items tpi
  join public.treatment_plans tp on tp.id = tpi.treatment_plan_id
  where tpi.id = v_usage.treatment_plan_item_id;

  if v_delta > 0 then
    select quantity, cost_per_unit into v_before, v_current_cost
    from public.clinic_inventory_items
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id
    for update;

    v_after := v_before - v_delta;

    if v_after < 0 then
      raise exception 'Cannot use more than the current stock (% available).', v_before;
    end if;

    update public.clinic_inventory_items
    set quantity = v_after, updated_at = now()
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id;

    insert into public.clinic_inventory_movements (
      clinic_id, inventory_item_id, movement_type, quantity_change,
      quantity_before, quantity_after, reason, created_by,
      unit_cost, patient_id, treatment_plan_item_id
    )
    values (
      v_clinic_id, v_usage.inventory_item_id, 'Decrease', -v_delta,
      v_before, v_after, 'Used', v_clinic_user_id,
      v_current_cost, v_patient_id, v_usage.treatment_plan_item_id
    );

    v_new_unit_cost := (v_usage.quantity * v_usage.unit_cost + v_delta * v_current_cost) / p_new_quantity;
  else
    select quantity into v_before
    from public.clinic_inventory_items
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id
    for update;

    v_after := v_before + abs(v_delta);

    update public.clinic_inventory_items
    set quantity = v_after, updated_at = now()
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id;

    insert into public.clinic_inventory_movements (
      clinic_id, inventory_item_id, movement_type, quantity_change,
      quantity_before, quantity_after, reason, created_by,
      unit_cost, patient_id, treatment_plan_item_id
    )
    values (
      v_clinic_id, v_usage.inventory_item_id, 'Increase', abs(v_delta),
      v_before, v_after, 'Consumption Reversal', v_clinic_user_id,
      v_usage.unit_cost, v_patient_id, v_usage.treatment_plan_item_id
    );

    -- Reducing quantity never changes the remaining portion's cost basis -
    -- only the already-consumed amount shrinks, at the same weighted-
    -- average cost the line already carried.
    v_new_unit_cost := v_usage.unit_cost;
  end if;

  if p_new_quantity = 0 then
    delete from public.treatment_material_usage where id = p_usage_id;
    return null;
  end if;

  update public.treatment_material_usage
  set quantity = p_new_quantity, unit_cost = v_new_unit_cost, updated_at = now()
  where id = p_usage_id
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.update_treatment_material_quantity(uuid, numeric) to authenticated;

/* ============================================================ */
/* 6. Actual material cost per catalog treatment name, batched -  */
/*    mirrors get_treatment_actuals_multi (0066) exactly (same    */
/*    normalized-name grouping, same security invoker/stable      */
/*    shape), so it can be joined against the same actuals map    */
/*    without a second, differently-shaped query.                 */
/* ============================================================ */

create or replace function public.get_treatment_actual_material_costs_multi(
  p_clinic_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  clinic_id uuid,
  treatment_name_normalized text,
  actual_material_cost numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    tpi.clinic_id,
    lower(trim(tpi.procedure)) as treatment_name_normalized,
    coalesce(sum(tmu.quantity * tmu.unit_cost), 0) as actual_material_cost
  from public.treatment_plan_items tpi
  join public.treatment_material_usage tmu on tmu.treatment_plan_item_id = tpi.id
  where tpi.clinic_id = any(p_clinic_ids)
    and (p_start is null or tpi.created_at >= p_start)
    and (p_end is null or tpi.created_at <= p_end)
    and trim(coalesce(tpi.procedure, '')) <> ''
  group by tpi.clinic_id, lower(trim(tpi.procedure));
$$;

grant execute on function public.get_treatment_actual_material_costs_multi(uuid[], timestamptz, timestamptz) to authenticated;
