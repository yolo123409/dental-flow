-- Inventory upgrade: expiry/batch tracking + an immutable stock movement
-- audit trail.
--
-- clinic_inventory_movements is deliberately SELECT+INSERT only - there is
-- NO update or delete policy, on purpose. Every quantity change is written
-- once by services/inventory.ts#adjustStock/createInventoryItem and never
-- edited afterwards - that's what makes it an audit trail rather than just
-- another mutable table. Do NOT "fix" a confusing RLS error on this table
-- later by copy-pasting the update/delete policies from
-- clinic_inventory_items (0011) - that would defeat the point.
--
-- batch_number/expiry_date on clinic_inventory_items are both nullable -
-- not every material needs lot/expiry tracking (gloves vs. local
-- anesthetic cartridges, for example). Existing rows get null for both,
-- no backfill needed since every consumer already treats them as optional.
--
-- Safe to re-run: add column/create table if not exists, drop policy if
-- exists + create, matching every other migration in this folder.

alter table public.clinic_inventory_items
  add column if not exists batch_number text,
  add column if not exists expiry_date date;

create table if not exists public.clinic_inventory_movements (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  inventory_item_id uuid not null
    references public.clinic_inventory_items(id) on delete cascade,

  movement_type text not null
    check (movement_type in ('Increase', 'Decrease')),

  quantity_change numeric(10, 2) not null,

  quantity_before numeric(10, 2) not null check (quantity_before >= 0),
  quantity_after numeric(10, 2) not null check (quantity_after >= 0),

  reason text not null check (
    reason in (
      'Restock', 'Used', 'Damaged', 'Expired',
      'Correction', 'Initial Stock', 'Other'
    )
  ),

  notes text,

  created_by uuid references public.clinic_users(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_inventory_movements_clinic_id
  on public.clinic_inventory_movements(clinic_id);

create index if not exists idx_clinic_inventory_movements_item_id
  on public.clinic_inventory_movements(inventory_item_id);

alter table public.clinic_inventory_movements enable row level security;

drop policy if exists "clinic_inventory_movements_select_own_clinic" on public.clinic_inventory_movements;
create policy "clinic_inventory_movements_select_own_clinic"
  on public.clinic_inventory_movements for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_movements.clinic_id
    )
  );

drop policy if exists "clinic_inventory_movements_insert_own_clinic" on public.clinic_inventory_movements;
create policy "clinic_inventory_movements_insert_own_clinic"
  on public.clinic_inventory_movements for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_movements.clinic_id
    )
  );
