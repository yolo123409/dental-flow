-- Advanced Inventory Stock Control.
--
-- AUDIT FINDING (before writing this): DentalFlow already has exactly the
-- "single source of truth" ledger the spec asks for -
-- clinic_inventory_movements (migration 0012), SELECT+INSERT-only (no
-- update/delete policy - already an immutable audit trail), already wired
-- through confirm_grn_receipt (0025/0027, idempotent GRN->inventory
-- posting) and services/inventory.ts#adjustStock (generic add/remove with
-- a reason). Per the spec's own instruction ("if an equivalent stock
-- movement/ledger table already exists, REUSE IT"), this migration EXTENDS
-- that table and its existing functions rather than creating a parallel
-- inventory_stock_movements table.
--
-- Two real gaps found and fixed here:
--
-- 1. adjustStock() (application code) makes two separate network calls -
--    an UPDATE on clinic_inventory_items.quantity, then an INSERT on
--    clinic_inventory_movements - with no transaction across them. If the
--    second call ever failed after the first succeeded, quantity and the
--    ledger would diverge, which is exactly the "GRN says 100 but
--    inventory says 80" failure mode section 2 of the spec warns against.
--    confirm_grn_receipt already does this correctly (one plpgsql
--    function, one transaction) - adjust_inventory_stock below brings
--    adjustStock/consumption/return-to-supplier up to the same standard.
--
-- 2. confirm_grn_receipt captures a GRN line's unit_cost onto the item's
--    live cost_per_unit (0027) but never captured batch_number/expiry_date
--    anywhere, and never recorded unit_cost/batch/supplier on the RECEIPT
--    movement row itself - so batch-level cost/expiry/supplier
--    traceability (spec sections 6, 15, 16, 20) was not actually reachable
--    even though clinic_grn_items already stores batch_number/expiry_date
--    per line. Fixed by writing those fields onto both the movement row
--    and (last-received-wins, same precedent as cost_per_unit) the item.
--
-- Batches are DERIVED from the movement ledger (grouped by batch_number),
-- not stored as a second mutable "quantity remaining per batch" table -
-- that would itself become a second source of truth that could drift from
-- the ledger, which is the exact problem section 2 says to avoid.
--
-- Safe to re-run: add column if not exists, drop constraint/policy/
-- function + recreate, matching every other migration in this folder.

/* -------------------------------------- */
/* Extend the movement ledger              */
/* -------------------------------------- */

alter table public.clinic_inventory_movements
  add column if not exists unit_cost numeric(10, 2),
  add column if not exists batch_number text,
  add column if not exists expiry_date date,
  add column if not exists supplier_id uuid references public.clinic_suppliers(id) on delete set null,
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists treatment_id uuid references public.clinic_treatments(id) on delete set null,
  add column if not exists reference text;

alter table public.clinic_inventory_movements
  drop constraint if exists clinic_inventory_movements_reason_check;

alter table public.clinic_inventory_movements
  add constraint clinic_inventory_movements_reason_check
  check (
    reason in (
      'Restock', 'Used', 'Damaged', 'Expired',
      'Correction', 'Initial Stock', 'Returned to Supplier', 'Other'
    )
  );

create index if not exists idx_clinic_inventory_movements_batch
  on public.clinic_inventory_movements(inventory_item_id, batch_number);

-- Cross-tenant safety: the existing insert policy (0012) only checks the
-- caller belongs to the target clinic. It never had to validate a foreign
-- reference before because it had none. Now that a movement can carry
-- supplier_id/patient_id/treatment_id, a caller crafting the INSERT
-- directly (bypassing the UI's clinic-scoped dropdowns) must not be able
-- to attach another clinic's supplier/patient/treatment to a movement -
-- same defense-in-depth pattern as clinic_grn_items' cross-tenant checks
-- (0025). Purely additive tightening of what INSERT already required;
-- every existing legitimate insert (all three id columns null) still
-- passes unchanged.
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
  );

/* -------------------------------------- */
/* Atomic stock adjustment RPC             */
/* -------------------------------------- */

-- Replaces adjustStock's two-call (UPDATE then INSERT) pattern with one
-- transactional function - also used by the new Record Consumption /
-- Return to Supplier flows, so every non-GRN stock change now goes through
-- exactly one, atomic, server-validated path. Role check mirrors
-- confirm_grn_receipt's own (Owner/Admin/Receptionist) - the same roles
-- lib/permissions.ts already grants "inventory_manage" to (Owner/Admin via
-- the "*" wildcard, Receptionist explicitly; Dentist has neither) - this
-- is a server-side backstop for a check the UI already makes, not a new
-- policy.
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
returns public.clinic_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_before numeric;
  v_after numeric;
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

  select quantity into v_before
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
    batch_number, expiry_date, supplier_id, patient_id, treatment_id, reference
  )
  values (
    v_clinic_id, p_item_id, case when p_delta > 0 then 'Increase' else 'Decrease' end, p_delta,
    v_before, v_after, p_reason, nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    nullif(trim(coalesce(p_batch_number, '')), ''), p_expiry_date, p_supplier_id, p_patient_id, p_treatment_id,
    nullif(trim(coalesce(p_reference, '')), '')
  );

  return v_item;
end;
$$;

grant execute on function public.adjust_inventory_stock(
  uuid, numeric, text, text, text, date, uuid, uuid, uuid, text
) to authenticated;

/* -------------------------------------- */
/* GRN receipt: capture batch/cost/supplier */
/* -------------------------------------- */

-- Re-declared with the identical signature/role-check/idempotency/locking
-- behavior as 0025/0027 - the only change is recording unit_cost/batch_
-- number/expiry_date/supplier_id on the RECEIPT movement it already
-- inserts, and (only when the GRN line actually specifies them, so an
-- unrelated no-batch GRN line never blanks out an item's existing batch
-- info - same "don't destroy batch information" rule the spec states in
-- section 6) copying batch_number/expiry_date onto the item, exactly
-- mirroring the existing cost_per_unit "latest received wins" precedent.
create or replace function public.confirm_grn_receipt(p_grn_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_grn record;
  v_item record;
  v_ordered numeric;
  v_already_received numeric;
  v_new_qty numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.clinic_goods_received_notes g on g.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and g.id = p_grn_id;

  if v_clinic_id is null then
    raise exception 'GRN not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to confirm goods received';
  end if;

  select * into v_grn from public.clinic_goods_received_notes where id = p_grn_id for update;

  if v_grn.status = 'Received' then
    return; -- idempotent no-op: double-click / refresh / retry
  end if;

  if v_grn.status = 'Cancelled' then
    raise exception 'Cannot confirm a cancelled GRN';
  end if;

  -- Serialize against a sibling GRN for the same PO being confirmed
  -- concurrently - locking this GRN's own row does not do that on its own.
  if v_grn.purchase_order_id is not null then
    perform 1 from public.clinic_purchase_orders where id = v_grn.purchase_order_id for update;
  end if;

  for v_item in select * from public.clinic_grn_items where grn_id = p_grn_id loop
    if v_item.purchase_order_item_id is not null then
      select quantity into v_ordered
      from public.clinic_purchase_order_items
      where id = v_item.purchase_order_item_id;

      select coalesce(sum(gi2.quantity_received), 0) into v_already_received
      from public.clinic_grn_items gi2
      join public.clinic_goods_received_notes g2 on g2.id = gi2.grn_id
      where gi2.purchase_order_item_id = v_item.purchase_order_item_id and g2.status = 'Received';

      if v_already_received + v_item.quantity_received > v_ordered then
        raise exception 'Over-receipt not allowed for this item';
      end if;
    end if;

    if v_item.quantity_received > 0 then
      update public.clinic_inventory_items
      set quantity = quantity + v_item.quantity_received,
          cost_per_unit = v_item.unit_cost,
          batch_number = coalesce(v_item.batch_number, batch_number),
          expiry_date = coalesce(v_item.expiry_date, expiry_date),
          updated_at = now()
      where id = v_item.inventory_item_id and clinic_id = v_clinic_id
      returning quantity into v_new_qty;

      if not found then
        raise exception 'Inventory item not found for this clinic';
      end if;

      insert into public.clinic_inventory_movements
        (clinic_id, inventory_item_id, movement_type, quantity_change, quantity_before, quantity_after,
         reason, notes, created_by, grn_id, unit_cost, batch_number, expiry_date, supplier_id)
      values
        (v_clinic_id, v_item.inventory_item_id, 'Increase', v_item.quantity_received,
         v_new_qty - v_item.quantity_received, v_new_qty, 'Restock',
         'GRN ' || v_grn.grn_number, v_clinic_user_id, p_grn_id,
         v_item.unit_cost, v_item.batch_number, v_item.expiry_date, v_grn.supplier_id);
    end if;
  end loop;

  update public.clinic_goods_received_notes
  set status = 'Received', received_at = now(), received_by = v_clinic_user_id, updated_at = now()
  where id = p_grn_id;

  if v_grn.purchase_order_id is not null then
    update public.clinic_purchase_orders po
    set status = (
      select case when bool_and(coalesce(recv.total_received, 0) >= poi.quantity) then 'Received' else 'Partially Received' end
      from public.clinic_purchase_order_items poi
      left join (
        select gi.purchase_order_item_id, sum(gi.quantity_received) as total_received
        from public.clinic_grn_items gi
        join public.clinic_goods_received_notes g on g.id = gi.grn_id
        where g.status = 'Received'
        group by gi.purchase_order_item_id
      ) recv on recv.purchase_order_item_id = poi.id
      where poi.purchase_order_id = po.id
    ),
    updated_at = now()
    where po.id = v_grn.purchase_order_id;
  end if;
end;
$$;

grant execute on function public.confirm_grn_receipt(uuid) to authenticated;
