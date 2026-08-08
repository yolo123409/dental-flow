-- ============================================================
-- Procurement & Inventory V1 - Phase B: Supplier foundation.
--
-- clinic_suppliers / clinic_supplier_contacts are the first two tables of
-- a new Procurement extension to the existing Inventory module (Suppliers
-- -> Purchase Orders -> Goods Received Notes -> Inventory posting).
-- Nothing procurement-related exists in the repo before this migration -
-- purely additive, no existing table/policy/function touched.
--
-- Naming follows repo convention: every clinic-owned table gets a
-- "clinic_" prefix (clinic_inventory_items, clinic_invoices,
-- clinic_insurance_providers), so these are clinic_suppliers /
-- clinic_supplier_contacts, not the bare suppliers/supplier_contacts.
--
-- Neither table gets a DELETE policy - suppliers/contacts are never hard
-- deleted (both referenced via "on delete restrict" from purchase orders
-- and GRNs once those exist), only archived via active = false.
-- ============================================================

create table if not exists public.clinic_suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_suppliers_clinic_id
  on public.clinic_suppliers(clinic_id);

alter table public.clinic_suppliers enable row level security;

drop policy if exists "clinic_suppliers_select_own_clinic" on public.clinic_suppliers;
create policy "clinic_suppliers_select_own_clinic"
  on public.clinic_suppliers for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_suppliers.clinic_id
    )
  );

drop policy if exists "clinic_suppliers_insert_own_clinic" on public.clinic_suppliers;
create policy "clinic_suppliers_insert_own_clinic"
  on public.clinic_suppliers for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_suppliers.clinic_id
    )
  );

drop policy if exists "clinic_suppliers_update_own_clinic" on public.clinic_suppliers;
create policy "clinic_suppliers_update_own_clinic"
  on public.clinic_suppliers for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_suppliers.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_suppliers.clinic_id
    )
  );

create table if not exists public.clinic_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.clinic_suppliers(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  job_title text,
  department text,
  phone text,
  whatsapp_number text,
  email text,
  is_primary boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_supplier_contacts_supplier_id
  on public.clinic_supplier_contacts(supplier_id);
create index if not exists idx_clinic_supplier_contacts_clinic_id
  on public.clinic_supplier_contacts(clinic_id);

-- At most one active primary contact per supplier.
create unique index if not exists uq_clinic_supplier_contacts_primary
  on public.clinic_supplier_contacts(supplier_id)
  where is_primary and active;

alter table public.clinic_supplier_contacts enable row level security;

drop policy if exists "clinic_supplier_contacts_select_own_clinic" on public.clinic_supplier_contacts;
create policy "clinic_supplier_contacts_select_own_clinic"
  on public.clinic_supplier_contacts for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_supplier_contacts.clinic_id
    )
  );

-- Cross-tenant FK guard: the referenced supplier must belong to the same
-- clinic as the contact row being written (not just "some clinic the
-- caller belongs to") - closes the gap a plain clinic-membership check
-- alone would leave open.
drop policy if exists "clinic_supplier_contacts_insert_own_clinic" on public.clinic_supplier_contacts;
create policy "clinic_supplier_contacts_insert_own_clinic"
  on public.clinic_supplier_contacts for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_supplier_contacts.clinic_id
    )
    and exists (
      select 1 from public.clinic_suppliers s
      where s.id = clinic_supplier_contacts.supplier_id
        and s.clinic_id = clinic_supplier_contacts.clinic_id
    )
  );

drop policy if exists "clinic_supplier_contacts_update_own_clinic" on public.clinic_supplier_contacts;
create policy "clinic_supplier_contacts_update_own_clinic"
  on public.clinic_supplier_contacts for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_supplier_contacts.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_supplier_contacts.clinic_id
    )
    and exists (
      select 1 from public.clinic_suppliers s
      where s.id = clinic_supplier_contacts.supplier_id
        and s.clinic_id = clinic_supplier_contacts.clinic_id
    )
  );
