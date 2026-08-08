-- ============================================================
-- Inventory Markup & Selling Price V1.
--
-- Three new nullable columns on the existing clinic_inventory_items
-- table - no new table, no RLS changes (they ride the table's existing
-- clinic-membership select/update policies exactly like every other
-- column added to it historically).
--
-- selling_price: the authoritative, always-manually-adjustable price.
-- target_markup_percent: the markup % the clinic most recently intended
--   (set whenever selling_price is saved, regardless of which input the
--   clinic actually typed into) - used ONLY to pre-fill the form and to
--   compute the "Apply X% Markup" suggestion after a cost change. NEVER
--   used to display "current markup" - that is always computed live from
--   cost_per_unit/selling_price at render time (application code).
-- priced_at_cost: a snapshot of cost_per_unit at the moment selling_price
--   was last saved - comparing this to the item's live cost_per_unit is
--   how the "cost changed - review selling price" notice is detected,
--   without a full price-history table (deferred, per spec).
-- ============================================================

alter table public.clinic_inventory_items
  add column if not exists selling_price numeric(10,2),
  add column if not exists target_markup_percent numeric(5,2),
  add column if not exists priced_at_cost numeric(10,2);

alter table public.clinic_inventory_items
  drop constraint if exists clinic_inventory_items_selling_price_non_negative;
alter table public.clinic_inventory_items
  add constraint clinic_inventory_items_selling_price_non_negative
  check (selling_price is null or selling_price >= 0);

-- Re-declared with the identical signature/role-check/idempotency/locking
-- behavior as 0025_procurement_grns.sql - the ONLY change is one extra
-- assignment (cost_per_unit = v_item.unit_cost) in the existing quantity
-- UPDATE, so a GRN's actual received cost becomes the item's "Latest
-- Cost". Deliberately does NOT touch selling_price/target_markup_percent/
-- priced_at_cost here - a received GRN must never silently change what
-- the clinic charges (spec section 9); the resulting cost/price mismatch
-- is surfaced in the UI by comparing priced_at_cost to the new
-- cost_per_unit, not resolved automatically.
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
          updated_at = now()
      where id = v_item.inventory_item_id and clinic_id = v_clinic_id
      returning quantity into v_new_qty;

      if not found then
        raise exception 'Inventory item not found for this clinic';
      end if;

      insert into public.clinic_inventory_movements
        (clinic_id, inventory_item_id, movement_type, quantity_change, quantity_before, quantity_after,
         reason, notes, created_by, grn_id)
      values
        (v_clinic_id, v_item.inventory_item_id, 'Increase', v_item.quantity_received,
         v_new_qty - v_item.quantity_received, v_new_qty, 'Restock',
         'GRN ' || v_grn.grn_number, v_clinic_user_id, p_grn_id);
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
