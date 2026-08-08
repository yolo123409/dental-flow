-- Money Out / Expense Management V1.
--
-- Two clinic-scoped tables (categories + expenses) plus a private storage
-- bucket for optional receipts. Role enforcement follows this repo's
-- established split: plain membership-only RLS for ordinary CRUD (matching
-- clinic_suppliers/clinic_purchase_orders - see 0023/0024), with the
-- narrower Owner/Admin-only write restriction reserved for clinic-wide
-- config tables (matching clinic_procurement_settings). Role gating for
-- "who gets the Record/Edit/Void UI at all" (Owner/Admin/Receptionist, not
-- Dentist) lives in lib/permissions.ts, same as billing/procurement -
-- financial CRUD in this app has never been role-gated at the RLS layer,
-- only at the app layer, and this stays consistent with that rather than
-- inventing a new, one-off stricter model just for this table.
--
-- No automatic expense creation from POs/GRNs/refunds/supplier payments
-- exists anywhere in this migration - source_type is checked down to
-- 'manual' only, on purpose (see clinic_expenses.source_type below).
--
-- Safe to re-run: create/drop-if-exists throughout, matching every other
-- migration in this folder.

-- ============================================================
-- 1. clinic_expense_categories
-- ============================================================

create table if not exists public.clinic_expense_categories (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_expense_categories_clinic_id
  on public.clinic_expense_categories(clinic_id);

-- Partial unique index (not a plain unique constraint) so a name can be
-- reused once the category that held it has been archived - same pattern
-- as uq_clinic_supplier_contacts_primary in 0023.
drop index if exists public.uq_clinic_expense_categories_active_name;
create unique index uq_clinic_expense_categories_active_name
  on public.clinic_expense_categories (clinic_id, lower(name)) where active;

alter table public.clinic_expense_categories enable row level security;

drop policy if exists "clinic_expense_categories_select_own_clinic" on public.clinic_expense_categories;
create policy "clinic_expense_categories_select_own_clinic"
  on public.clinic_expense_categories for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_expense_categories.clinic_id
    )
  );

-- Category management is clinic-wide configuration (like procurement
-- document settings), so it's Owner/Admin-only - reuses the existing
-- is_clinic_owner_or_admin() helper from 0008 rather than inlining a new
-- role check.
drop policy if exists "clinic_expense_categories_insert_admin_only" on public.clinic_expense_categories;
create policy "clinic_expense_categories_insert_admin_only"
  on public.clinic_expense_categories for insert
  with check (public.is_clinic_owner_or_admin(clinic_expense_categories.clinic_id));

drop policy if exists "clinic_expense_categories_update_admin_only" on public.clinic_expense_categories;
create policy "clinic_expense_categories_update_admin_only"
  on public.clinic_expense_categories for update
  using (public.is_clinic_owner_or_admin(clinic_expense_categories.clinic_id))
  with check (public.is_clinic_owner_or_admin(clinic_expense_categories.clinic_id));

-- No delete policy - archive only (active = false), matching suppliers.

-- ============================================================
-- 2. clinic_expenses
-- ============================================================

create table if not exists public.clinic_expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  category_id uuid not null references public.clinic_expense_categories(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  description text not null,
  payee text,
  supplier_id uuid references public.clinic_suppliers(id) on delete set null,
  payment_method text not null,
  reference text,
  notes text,
  receipt_path text,
  status text not null default 'Paid' check (status in ('Paid', 'Voided')),
  -- Hook for future automatic integrations (supplier payments, refunds) -
  -- restricted to 'manual' for V1 so nothing can silently double-count.
  -- Extending this check to add a new source_type is a one-line future
  -- migration, same drop/recreate-constraint convention used elsewhere.
  source_type text not null default 'manual' check (source_type in ('manual')),
  source_id uuid,
  voided_at timestamptz,
  voided_by uuid references public.clinic_users(id) on delete set null,
  void_reason text,
  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_expenses_clinic_date
  on public.clinic_expenses (clinic_id, expense_date desc);
create index if not exists idx_clinic_expenses_category_id
  on public.clinic_expenses (category_id);
create index if not exists idx_clinic_expenses_supplier_id
  on public.clinic_expenses (supplier_id);

alter table public.clinic_expenses enable row level security;

drop policy if exists "clinic_expenses_select_own_clinic" on public.clinic_expenses;
create policy "clinic_expenses_select_own_clinic"
  on public.clinic_expenses for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_expenses.clinic_id
    )
  );

-- with check requires: caller is a member of the expense's own clinic,
-- the referenced category belongs to that same clinic, and (when set) the
-- referenced supplier belongs to that same clinic too - closes the same
-- cross-tenant FK-injection gap the PO items policy closes in 0024.
drop policy if exists "clinic_expenses_insert_own_clinic" on public.clinic_expenses;
create policy "clinic_expenses_insert_own_clinic"
  on public.clinic_expenses for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_expenses.clinic_id
    )
    and exists (
      select 1 from public.clinic_expense_categories cat
      where cat.id = clinic_expenses.category_id and cat.clinic_id = clinic_expenses.clinic_id
    )
    and (
      clinic_expenses.supplier_id is null
      or exists (
        select 1 from public.clinic_suppliers s
        where s.id = clinic_expenses.supplier_id and s.clinic_id = clinic_expenses.clinic_id
      )
    )
  );

-- Plain UPDATE covers both edits and voiding (status -> 'Voided'). The
-- using-clause status = 'Paid' check means once a row is Voided, no
-- further UPDATE (edit or re-void) can touch it - a voided expense is
-- read-only from here on, matching the PO items' Draft-only update
-- convention. No concurrency/aggregation risk like GRN posting, so no
-- SECURITY DEFINER function is needed for either edit or void.
drop policy if exists "clinic_expenses_update_own_clinic" on public.clinic_expenses;
create policy "clinic_expenses_update_own_clinic"
  on public.clinic_expenses for update
  using (
    status = 'Paid'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_expenses.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_expense_categories cat
      where cat.id = clinic_expenses.category_id and cat.clinic_id = clinic_expenses.clinic_id
    )
    and (
      clinic_expenses.supplier_id is null
      or exists (
        select 1 from public.clinic_suppliers s
        where s.id = clinic_expenses.supplier_id and s.clinic_id = clinic_expenses.clinic_id
      )
    )
  );

-- No delete policy - void only.

-- ============================================================
-- 3. expense-receipts storage bucket
--    Object paths are `${clinicId}/${expenseId}/${filename}` - mirrors the
--    clinic-assets bucket pattern from 0010, except private (not public):
--    receipts are financial records, not something meant to render via a
--    public URL the way a clinic logo does.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  5242880, -- 5MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "expense_receipts_select_own_clinic" on storage.objects;
create policy "expense_receipts_select_own_clinic"
  on storage.objects for select
  using (
    bucket_id = 'expense-receipts'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "expense_receipts_insert_own_clinic" on storage.objects;
create policy "expense_receipts_insert_own_clinic"
  on storage.objects for insert
  with check (
    bucket_id = 'expense-receipts'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "expense_receipts_update_own_clinic" on storage.objects;
create policy "expense_receipts_update_own_clinic"
  on storage.objects for update
  using (
    bucket_id = 'expense-receipts'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'expense-receipts'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "expense_receipts_delete_own_clinic" on storage.objects;
create policy "expense_receipts_delete_own_clinic"
  on storage.objects for delete
  using (
    bucket_id = 'expense-receipts'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  );
