-- FIN-4.8: closes a lost-update race in update_treatment_material_quantity()
-- (migration 0088) - "two users modifying the same treatment material
-- quantity", one of the race scenarios this phase's brief names
-- explicitly, found and reproduced by this phase's concurrency testing.
--
-- THE GAP: this function reads treatment_material_usage with a plain
-- SELECT (no row lock), computes v_delta = p_new_quantity - (that stale
-- quantity), and later does an ABSOLUTE update
-- (set quantity = p_new_quantity) to the usage row. The inventory side
-- IS already safe - clinic_inventory_items is read with `for update`
-- before either branch adjusts it, so two concurrent calls' stock
-- movements always add up correctly. But two concurrent calls computing
-- v_delta from the SAME stale usage.quantity can each independently
-- decide there's stock to restock/consume that the OTHER call has
-- already accounted for - e.g. two concurrent requests both reducing a
-- 10-unit line to 5 units (a double-submit, not two different edits)
-- both read quantity=10, both compute delta=-5, both correctly and
-- safely restock 5 units each to clinic_inventory_items (its own lock
-- makes THAT arithmetic correct) - but that means 10 units get restocked
-- for what should have been a single 5-unit reversal. The final
-- treatment_material_usage.quantity (5, written by whichever call
-- finishes last) looks unremarkable and hides that the inventory side
-- was double-credited.
--
-- THE FIX: `select ... for update` on the treatment_material_usage row,
-- taken before v_delta is computed - same technique as migrations
-- 0102/0103. A second concurrent caller targeting the same usage row
-- now blocks until the first's transaction commits, then computes
-- v_delta against the ALREADY-UPDATED quantity, so two calls' effects
-- add up instead of one silently duplicating or losing the other's.
-- Every other line is unchanged from migration 0088 - same cost-basis
-- math, same movement records, same delete-at-zero behavior.

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

  -- Locked here (for update), before v_delta is computed against it -
  -- the actual fix. A second concurrent caller targeting this same
  -- usage row blocks until this transaction commits or rolls back.
  select * into v_usage
  from public.treatment_material_usage
  where id = p_usage_id and clinic_id = v_clinic_id
  for update;

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

-- Signature unchanged - create or replace, no grant/drop needed.
