-- Full-app audit fix H13 (High), folded into the same confirm_grn_receipt
-- rewrite since both touch it: GRN "Unit Cost" isn't required client-side
-- (GRNItemModal.tsx) and 0 is a legal value at the database level too -
-- confirm_grn_receipt unconditionally overwrites cost_per_unit with
-- whatever was entered, corrupting that item's valuation (and every
-- future consumption's COGS) clinic-wide from one blank field. Fix: raise
-- if any line item being confirmed has unit_cost <= 0 - the client-side
-- required-field fix is separate (GRNItemModal.tsx), this is the
-- database backstop.
--
-- Full-app audit fix H12 (High): cancel_purchase_order (migration 0024)
-- never touches sibling GRNs, and confirm_grn_receipt (migration 0042)
-- never checks its parent PO's status - so cancelling a PO that still has
-- a pending Draft GRN, then later confirming that GRN, silently
-- un-cancels the PO (confirm_grn_receipt's own final step unconditionally
-- recomputes and overwrites the PO's status based on received-vs-ordered
-- quantities) and posts real inventory/AP as if the order were still
-- live.
--
-- THE FIX, belt-and-suspenders - either alone closes the reported
-- scenario, both together close it even if a Draft GRN is somehow
-- created after the PO is already cancelled:
--   1. cancel_purchase_order also cancels every 'Draft' GRN linked to
--      that PO, in the same transaction (a 'Received' GRN is already
--      correctly out of reach - cancel_purchase_order already refuses to
--      cancel a PO that's 'Received'/'Partially Received', and a
--      Received GRN's own status blocks confirm_grn_receipt's no-op path
--      from mattering here).
--   2. confirm_grn_receipt refuses outright if the parent PO's status is
--      'Cancelled'.
--
-- Every other line of both functions is unchanged from their current
-- live versions (0024/0042) - same signatures, same role checks, same
-- locking order.
--
-- Safe to re-run: create or replace function, same signatures.

create or replace function public.cancel_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_status text;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id, po.status
    into v_clinic_id, v_role, v_clinic_user_id, v_status
  from public.clinic_users cu
  join public.clinic_purchase_orders po on po.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and po.id = p_po_id;

  if v_clinic_id is null then
    raise exception 'Purchase order not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to cancel this purchase order';
  end if;

  -- Cancelling a fully/partially Received PO is out of scope for V1 (no
  -- reversal system) - only pre-receipt cancellation is supported.
  if v_status in ('Received', 'Partially Received') then
    raise exception 'Cannot cancel a purchase order that has already received goods';
  end if;

  if v_status = 'Cancelled' then
    return;
  end if;

  update public.clinic_purchase_orders
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = v_clinic_user_id, updated_at = now()
  where id = p_po_id;

  -- Full-app audit fix H12: cancel every still-Draft GRN linked to this
  -- PO too - a Received one is already financially posted and out of
  -- scope for the same reason cancelling a Received PO is.
  update public.clinic_goods_received_notes
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = v_clinic_user_id, updated_at = now()
  where purchase_order_id = p_po_id
    and status = 'Draft';
end;
$$;

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
  v_po_status text;
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
    select status into v_po_status from public.clinic_purchase_orders where id = v_grn.purchase_order_id for update;

    -- Full-app audit fix H12: refuse outright if the parent PO has been
    -- cancelled - closes the "cancel PO, then confirm its still-Draft
    -- GRN anyway" path even if a Draft GRN somehow still exists (the
    -- cascade above is the primary fix; this is the backstop).
    if v_po_status = 'Cancelled' then
      raise exception 'Cannot confirm receipt against a cancelled purchase order';
    end if;
  end if;

  -- Full-app audit fix H13: refuse to confirm if any line item has a
  -- non-positive unit cost - checked up front, before any inventory
  -- write, so a bad line can never partially post.
  if exists (
    select 1 from public.clinic_grn_items
    where grn_id = p_grn_id and coalesce(unit_cost, 0) <= 0
  ) then
    raise exception 'Every line item must have a unit cost greater than 0 before this GRN can be confirmed.';
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
