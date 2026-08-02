-- Inventory Management V1: manual material/stock tracking, one row per
-- material, scoped to a single clinic.
--
-- Mirrors the clinic_invoice_items naming precedent and the
-- appointments_all_own_clinic RLS shape (migration 0001) - any member of
-- the owning clinic can read/write, split into 4 explicit policies per
-- the exact per-statement clause shape already used in
-- 0010_clinic_profile_hardening.sql's storage.objects policies (select/
-- delete get `using` only, insert gets `with check` only, update gets
-- both). Not admin-only: stock tracking is everyday operational work,
-- like appointments, not admin-only config like clinic tax settings.
--
-- quantity/cost_per_unit/minimum_stock_level all have `check (... >= 0)` -
-- the DB-level backstop against negative values; the app enforces this
-- earlier with a clear error message before ever attempting the write.
--
-- Safe to re-run: create table/index if not exists, drop policy if
-- exists + create, matching every other migration in this folder.

create table if not exists public.clinic_inventory_items (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  name text not null,
  category text,

  quantity numeric(10, 2) not null default 0 check (quantity >= 0),
  unit text not null,

  cost_per_unit numeric(10, 2) not null default 0 check (cost_per_unit >= 0),
  minimum_stock_level numeric(10, 2) not null default 0 check (minimum_stock_level >= 0),

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_inventory_items_clinic_id
  on public.clinic_inventory_items(clinic_id);

alter table public.clinic_inventory_items enable row level security;

drop policy if exists "clinic_inventory_items_select_own_clinic" on public.clinic_inventory_items;
create policy "clinic_inventory_items_select_own_clinic"
  on public.clinic_inventory_items for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_items.clinic_id
    )
  );

drop policy if exists "clinic_inventory_items_insert_own_clinic" on public.clinic_inventory_items;
create policy "clinic_inventory_items_insert_own_clinic"
  on public.clinic_inventory_items for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_items.clinic_id
    )
  );

drop policy if exists "clinic_inventory_items_update_own_clinic" on public.clinic_inventory_items;
create policy "clinic_inventory_items_update_own_clinic"
  on public.clinic_inventory_items for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_items.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_items.clinic_id
    )
  );

drop policy if exists "clinic_inventory_items_delete_own_clinic" on public.clinic_inventory_items;
create policy "clinic_inventory_items_delete_own_clinic"
  on public.clinic_inventory_items for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_inventory_items.clinic_id
    )
  );
