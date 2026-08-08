-- ============================================================
-- Procurement & Inventory V1 - Phase C: Purchase Orders.
--
-- Concurrency-safe document numbering (clinic_document_counters +
-- next_document_number) replaces the known-bad client-side
-- COUNT(*)+1 pattern used by services/billing.ts#generateInvoiceNumber -
-- that function has no DB uniqueness backstop and a real race condition;
-- deliberately not repeated here. next_document_number derives clinic_id
-- membership server-side rather than trusting a client-supplied
-- clinic_id, and clinic_purchase_orders.po_number carries its own
-- unique(clinic_id, po_number) constraint as a backstop.
--
-- clinic_purchase_orders'/clinic_purchase_order_items' UPDATE RLS pins
-- status = 'Draft' so a raw client PATCH can never move a PO out of
-- Draft - every other transition (Sent/Cancelled) only happens through
-- the security definer functions below, which independently re-check
-- role server-side.
-- ============================================================

create table if not exists public.clinic_document_counters (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  document_type text not null check (document_type in ('purchase_order', 'grn')),
  next_number int not null default 1,
  primary key (clinic_id, document_type)
);

-- No client-facing RLS policies at all - only next_document_number
-- (security definer, below) ever touches this table.
alter table public.clinic_document_counters enable row level security;

create or replace function public.next_document_number(
  p_clinic_id uuid,
  p_document_type text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_next int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id
  ) then
    raise exception 'Not a member of this clinic';
  end if;

  if p_document_type not in ('purchase_order', 'grn') then
    raise exception 'Invalid document type';
  end if;

  insert into public.clinic_document_counters (clinic_id, document_type, next_number)
  values (p_clinic_id, p_document_type, 1)
  on conflict (clinic_id, document_type)
  do update set next_number = clinic_document_counters.next_number + 1
  returning next_number into v_next;

  return v_next;
end;
$$;

grant execute on function public.next_document_number(uuid, text) to authenticated;

create table if not exists public.clinic_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  po_number text not null,
  supplier_id uuid not null references public.clinic_suppliers(id) on delete restrict,
  supplier_contact_id uuid references public.clinic_supplier_contacts(id) on delete set null,
  order_date date not null default current_date,
  expected_delivery_date date,
  delivery_location text,
  notes text,
  status text not null default 'Draft'
    check (status in ('Draft', 'Sent', 'Partially Received', 'Received', 'Cancelled')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid references public.clinic_users(id) on delete set null,
  sent_at timestamptz,
  sent_via text check (sent_via in ('Email', 'WhatsApp')),
  sent_to_contact_id uuid references public.clinic_supplier_contacts(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, po_number)
);

create index if not exists idx_clinic_purchase_orders_clinic_id
  on public.clinic_purchase_orders(clinic_id);
create index if not exists idx_clinic_purchase_orders_supplier_id
  on public.clinic_purchase_orders(supplier_id);

alter table public.clinic_purchase_orders enable row level security;

drop policy if exists "clinic_purchase_orders_select_own_clinic" on public.clinic_purchase_orders;
create policy "clinic_purchase_orders_select_own_clinic"
  on public.clinic_purchase_orders for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_orders.clinic_id
    )
  );

drop policy if exists "clinic_purchase_orders_insert_own_clinic" on public.clinic_purchase_orders;
create policy "clinic_purchase_orders_insert_own_clinic"
  on public.clinic_purchase_orders for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_orders.clinic_id
    )
    and exists (
      select 1 from public.clinic_suppliers s
      where s.id = clinic_purchase_orders.supplier_id and s.clinic_id = clinic_purchase_orders.clinic_id
    )
    and status = 'Draft'
  );

-- Plain client UPDATEs may only touch a Draft PO and may not move it out
-- of Draft themselves - sending/cancelling go through the functions below.
drop policy if exists "clinic_purchase_orders_update_draft_own_clinic" on public.clinic_purchase_orders;
create policy "clinic_purchase_orders_update_draft_own_clinic"
  on public.clinic_purchase_orders for update
  using (
    status = 'Draft'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_orders.clinic_id
    )
  )
  with check (
    status = 'Draft'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_orders.clinic_id
    )
    and exists (
      select 1 from public.clinic_suppliers s
      where s.id = clinic_purchase_orders.supplier_id and s.clinic_id = clinic_purchase_orders.clinic_id
    )
  );

create table if not exists public.clinic_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.clinic_purchase_orders(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  inventory_item_id uuid not null references public.clinic_inventory_items(id) on delete restrict,
  description text,
  quantity numeric(10,2) not null check (quantity > 0),
  unit text not null,
  unit_price numeric(10,2) not null default 0 check (unit_price >= 0),
  line_total numeric(12,2) not null default 0 check (line_total >= 0),
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_purchase_order_items_po_id
  on public.clinic_purchase_order_items(purchase_order_id);

alter table public.clinic_purchase_order_items enable row level security;

drop policy if exists "clinic_purchase_order_items_select_own_clinic" on public.clinic_purchase_order_items;
create policy "clinic_purchase_order_items_select_own_clinic"
  on public.clinic_purchase_order_items for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_order_items.clinic_id
    )
  );

-- with check requires: caller is a member of the item's own clinic, the
-- parent PO belongs to that same clinic AND is still Draft, and the
-- referenced inventory item belongs to that same clinic too - closes the
-- cross-tenant/cross-status FK gaps a plain membership check would leave.
drop policy if exists "clinic_purchase_order_items_insert_own_clinic" on public.clinic_purchase_order_items;
create policy "clinic_purchase_order_items_insert_own_clinic"
  on public.clinic_purchase_order_items for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_order_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_purchase_orders po
      where po.id = clinic_purchase_order_items.purchase_order_id
        and po.clinic_id = clinic_purchase_order_items.clinic_id
        and po.status = 'Draft'
    )
    and exists (
      select 1 from public.clinic_inventory_items ii
      where ii.id = clinic_purchase_order_items.inventory_item_id
        and ii.clinic_id = clinic_purchase_order_items.clinic_id
    )
  );

drop policy if exists "clinic_purchase_order_items_update_own_clinic" on public.clinic_purchase_order_items;
create policy "clinic_purchase_order_items_update_own_clinic"
  on public.clinic_purchase_order_items for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_order_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_purchase_orders po
      where po.id = clinic_purchase_order_items.purchase_order_id
        and po.clinic_id = clinic_purchase_order_items.clinic_id
        and po.status = 'Draft'
    )
  )
  with check (
    exists (
      select 1 from public.clinic_inventory_items ii
      where ii.id = clinic_purchase_order_items.inventory_item_id
        and ii.clinic_id = clinic_purchase_order_items.clinic_id
    )
  );

drop policy if exists "clinic_purchase_order_items_delete_own_clinic" on public.clinic_purchase_order_items;
create policy "clinic_purchase_order_items_delete_own_clinic"
  on public.clinic_purchase_order_items for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_purchase_order_items.clinic_id
    )
    and exists (
      select 1 from public.clinic_purchase_orders po
      where po.id = clinic_purchase_order_items.purchase_order_id
        and po.clinic_id = clinic_purchase_order_items.clinic_id
        and po.status = 'Draft'
    )
  );

-- Recomputes subtotal/total from the current line items. Called by app
-- code after a batch of item edits rather than a per-row trigger, so the
-- app controls exactly when the recalculation happens.
create or replace function public.recalculate_purchase_order_totals(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_subtotal numeric(12,2);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select clinic_id into v_clinic_id from public.clinic_purchase_orders where id = p_po_id;

  if v_clinic_id is null then
    raise exception 'Purchase order not found';
  end if;

  if not exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id
  ) then
    raise exception 'Not a member of this clinic';
  end if;

  select coalesce(sum(line_total), 0) into v_subtotal
  from public.clinic_purchase_order_items
  where purchase_order_id = p_po_id;

  update public.clinic_purchase_orders
  set subtotal = v_subtotal, total = v_subtotal, updated_at = now()
  where id = p_po_id;
end;
$$;

grant execute on function public.recalculate_purchase_order_totals(uuid) to authenticated;

create or replace function public.mark_purchase_order_sent(
  p_po_id uuid,
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
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, po.status into v_clinic_id, v_role, v_status
  from public.clinic_users cu
  join public.clinic_purchase_orders po on po.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and po.id = p_po_id;

  if v_clinic_id is null then
    raise exception 'Purchase order not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to send this purchase order';
  end if;

  if v_status not in ('Draft', 'Sent') then
    raise exception 'Only a Draft or already-Sent purchase order can be sent';
  end if;

  if p_via not in ('Email', 'WhatsApp') then
    raise exception 'Invalid send method';
  end if;

  update public.clinic_purchase_orders
  set status = 'Sent', sent_at = now(), sent_via = p_via, sent_to_contact_id = p_contact_id,
      updated_at = now()
  where id = p_po_id;
end;
$$;

grant execute on function public.mark_purchase_order_sent(uuid, text, uuid) to authenticated;

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
end;
$$;

grant execute on function public.cancel_purchase_order(uuid) to authenticated;

-- ============================================================
-- Procurement document customization/settings (folded into this phase
-- since both the PO and GRN document views need it).
-- ============================================================

create table if not exists public.clinic_procurement_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  po_prefix text not null default 'PO',
  po_document_title text not null default 'Purchase Order',
  po_header_text text,
  po_footer_text text,
  po_default_notes text,
  po_terms text,
  po_signature_label text not null default 'Authorized By',
  po_custom_fields jsonb not null default '[]'::jsonb,
  grn_prefix text not null default 'GRN',
  grn_document_title text not null default 'Goods Received Note',
  grn_header_text text,
  grn_footer_text text,
  grn_visible_columns jsonb not null default
    '{"ordered":true,"received":true,"unit":true,"unit_cost":true,"batch":false,"expiry":false}'::jsonb,
  grn_signature_label text not null default 'Received By',
  grn_custom_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_procurement_settings enable row level security;

drop policy if exists "clinic_procurement_settings_select_own_clinic" on public.clinic_procurement_settings;
create policy "clinic_procurement_settings_select_own_clinic"
  on public.clinic_procurement_settings for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_procurement_settings.clinic_id
    )
  );

drop policy if exists "clinic_procurement_settings_insert_admin_only" on public.clinic_procurement_settings;
create policy "clinic_procurement_settings_insert_admin_only"
  on public.clinic_procurement_settings for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_procurement_settings.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

drop policy if exists "clinic_procurement_settings_update_admin_only" on public.clinic_procurement_settings;
create policy "clinic_procurement_settings_update_admin_only"
  on public.clinic_procurement_settings for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_procurement_settings.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_procurement_settings.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );
