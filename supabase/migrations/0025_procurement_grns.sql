-- ============================================================
-- Procurement & Inventory V1 - Phase E/F: Goods Received Notes +
-- inventory posting.
--
-- clinic_goods_received_notes / clinic_grn_items follow the exact same
-- RLS shape as the Purchase Order tables in 0024 (status = 'Draft' pinned
-- on the client UPDATE policy, cross-tenant/cross-status checks on
-- inserts). confirm_grn_receipt is the highest-risk function in this
-- feature - the only path allowed to increase clinic_inventory_items.quantity
-- for a procurement receipt. Purely additive: the one alter table on
-- clinic_inventory_movements adds a nullable column, so every existing
-- movement row (all pre-dating this feature) is unaffected.
-- ============================================================

create table if not exists public.clinic_goods_received_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  grn_number text not null,
  purchase_order_id uuid references public.clinic_purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.clinic_suppliers(id) on delete restrict,
  supplier_contact_id uuid references public.clinic_supplier_contacts(id) on delete set null,
  supplier_delivery_note text,
  date_received date not null default current_date,
  status text not null default 'Draft' check (status in ('Draft', 'Received', 'Cancelled')),
  received_by uuid references public.clinic_users(id) on delete set null,
  received_at timestamptz,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  sent_via text check (sent_via in ('Email', 'WhatsApp')),
  sent_to_contact_id uuid references public.clinic_supplier_contacts(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, grn_number)
);

create index if not exists idx_clinic_grns_clinic_id on public.clinic_goods_received_notes(clinic_id);
create index if not exists idx_clinic_grns_po_id on public.clinic_goods_received_notes(purchase_order_id);

alter table public.clinic_goods_received_notes enable row level security;

drop policy if exists "clinic_grns_select_own_clinic" on public.clinic_goods_received_notes;
create policy "clinic_grns_select_own_clinic"
  on public.clinic_goods_received_notes for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_goods_received_notes.clinic_id
    )
  );

drop policy if exists "clinic_grns_insert_own_clinic" on public.clinic_goods_received_notes;
create policy "clinic_grns_insert_own_clinic"
  on public.clinic_goods_received_notes for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_goods_received_notes.clinic_id
    )
    and exists (
      select 1 from public.clinic_suppliers s
      where s.id = clinic_goods_received_notes.supplier_id and s.clinic_id = clinic_goods_received_notes.clinic_id
    )
    and (
      clinic_goods_received_notes.purchase_order_id is null
      or exists (
        select 1 from public.clinic_purchase_orders po
        where po.id = clinic_goods_received_notes.purchase_order_id
          and po.clinic_id = clinic_goods_received_notes.clinic_id
          and po.supplier_id = clinic_goods_received_notes.supplier_id
          and po.status in ('Sent', 'Partially Received')
      )
    )
    and status = 'Draft'
  );

drop policy if exists "clinic_grns_update_draft_own_clinic" on public.clinic_goods_received_notes;
create policy "clinic_grns_update_draft_own_clinic"
  on public.clinic_goods_received_notes for update
  using (
    status = 'Draft'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_goods_received_notes.clinic_id
    )
  )
  with check (
    status = 'Draft'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_goods_received_notes.clinic_id
    )
  );

create table if not exists public.clinic_grn_items (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.clinic_goods_received_notes(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  purchase_order_item_id uuid references public.clinic_purchase_order_items(id) on delete restrict,
  inventory_item_id uuid not null references public.clinic_inventory_items(id) on delete restrict,
  description text,
  quantity_ordered numeric(10,2),
  quantity_previously_received numeric(10,2) not null default 0,
  quantity_received numeric(10,2) not null default 0 check (quantity_received >= 0),
  unit text not null,
  unit_cost numeric(10,2) not null default 0 check (unit_cost >= 0),
  batch_number text,
  expiry_date date,
  notes text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_grn_items_grn_id on public.clinic_grn_items(grn_id);
create index if not exists idx_clinic_grn_items_po_item_id on public.clinic_grn_items(purchase_order_item_id);

alter table public.clinic_grn_items enable row level security;

drop policy if exists "clinic_grn_items_select_own_clinic" on public.clinic_grn_items;
create policy "clinic_grn_items_select_own_clinic"
  on public.clinic_grn_items for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_grn_items.clinic_id
    )
  );

drop policy if exists "clinic_grn_items_insert_own_clinic" on public.clinic_grn_items;
create policy "clinic_grn_items_insert_own_clinic"
  on public.clinic_grn_items for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_grn_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_goods_received_notes g
      where g.id = clinic_grn_items.grn_id
        and g.clinic_id = clinic_grn_items.clinic_id
        and g.status = 'Draft'
    )
    and exists (
      select 1 from public.clinic_inventory_items ii
      where ii.id = clinic_grn_items.inventory_item_id
        and ii.clinic_id = clinic_grn_items.clinic_id
    )
    and (
      clinic_grn_items.purchase_order_item_id is null
      or exists (
        select 1 from public.clinic_purchase_order_items poi
        join public.clinic_goods_received_notes g on g.id = clinic_grn_items.grn_id
        where poi.id = clinic_grn_items.purchase_order_item_id
          and poi.clinic_id = clinic_grn_items.clinic_id
          and poi.purchase_order_id = g.purchase_order_id
      )
    )
  );

drop policy if exists "clinic_grn_items_update_own_clinic" on public.clinic_grn_items;
create policy "clinic_grn_items_update_own_clinic"
  on public.clinic_grn_items for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_grn_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_goods_received_notes g
      where g.id = clinic_grn_items.grn_id and g.clinic_id = clinic_grn_items.clinic_id and g.status = 'Draft'
    )
  )
  with check (
    exists (
      select 1 from public.clinic_inventory_items ii
      where ii.id = clinic_grn_items.inventory_item_id and ii.clinic_id = clinic_grn_items.clinic_id
    )
  );

drop policy if exists "clinic_grn_items_delete_own_clinic" on public.clinic_grn_items;
create policy "clinic_grn_items_delete_own_clinic"
  on public.clinic_grn_items for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_grn_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_goods_received_notes g
      where g.id = clinic_grn_items.grn_id and g.clinic_id = clinic_grn_items.clinic_id and g.status = 'Draft'
    )
  );

alter table public.clinic_inventory_movements add column if not exists grn_id uuid
  references public.clinic_goods_received_notes(id) on delete set null;
create index if not exists idx_clinic_inventory_movements_grn_id on public.clinic_inventory_movements(grn_id);

-- ============================================================
-- confirm_grn_receipt: the only path that posts a GRN's received
-- quantities into clinic_inventory_items. Every fix from the Plan-agent
-- security review is incorporated:
--   - idempotent: a Received GRN re-confirmed is a silent no-op: a
--     Cancelled one raises a clear error rather than silently no-op'ing.
--   - the row lock on THIS GRN alone doesn't serialize against a
--     DIFFERENT GRN against the same PO being confirmed concurrently, so
--     the parent PO row is also locked before any over-receipt aggregate
--     is computed (closes a real write-skew race).
--   - "already received" is recomputed fresh from confirmed sibling GRNs
--     at confirm time, never trusted from the quantity_previously_received
--     display snapshot captured when this GRN was created.
--   - "if not found" after the scoped inventory UPDATE guards against a
--     cross-tenant inventory_item_id silently matching zero rows.
-- ============================================================

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
      set quantity = quantity + v_item.quantity_received, updated_at = now()
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

create or replace function public.mark_grn_sent(
  p_grn_id uuid,
  p_via text,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role into v_clinic_id, v_role
  from public.clinic_users cu
  join public.clinic_goods_received_notes g on g.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and g.id = p_grn_id;

  if v_clinic_id is null then
    raise exception 'GRN not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to send this GRN';
  end if;

  if p_via not in ('Email', 'WhatsApp') then
    raise exception 'Invalid send method';
  end if;

  update public.clinic_goods_received_notes
  set sent_at = now(), sent_via = p_via, sent_to_contact_id = p_contact_id, updated_at = now()
  where id = p_grn_id;
end;
$$;

grant execute on function public.mark_grn_sent(uuid, text, uuid) to authenticated;

create or replace function public.cancel_grn(p_grn_id uuid)
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

  select cu.clinic_id, cu.role, cu.id, g.status into v_clinic_id, v_role, v_clinic_user_id, v_status
  from public.clinic_users cu
  join public.clinic_goods_received_notes g on g.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and g.id = p_grn_id;

  if v_clinic_id is null then
    raise exception 'GRN not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to cancel this GRN';
  end if;

  -- Cancelling a Received GRN (stock already posted) is out of scope for
  -- V1 - no reversal system, matching the spec's "don't build a giant
  -- reversal system now."
  if v_status = 'Received' then
    raise exception 'Cannot cancel a GRN that has already posted to inventory';
  end if;

  if v_status = 'Cancelled' then
    return;
  end if;

  update public.clinic_goods_received_notes
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = v_clinic_user_id, updated_at = now()
  where id = p_grn_id;
end;
$$;

grant execute on function public.cancel_grn(uuid) to authenticated;
