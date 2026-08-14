-- ============================================================
-- Accounting Phase 2: Supplier Accounts Payable Settlement.
--
-- AUDIT FINDINGS (before writing this):
--   - migration 0043 already posts Dr Inventory / Cr Accounts Payable
--     when a GRN is received (_trigger_post_grn_ledger) - that half of
--     the workflow already exists and is untouched here.
--   - The missing half (supplier payment -> Dr A/P, Cr Cash/Bank/M-Pesa)
--     has no existing table or code path anywhere - Money Out
--     (clinic_expenses) has an optional supplier_id but is a DECOUPLED,
--     unrelated concept (an expense category, never a liability
--     settlement - already documented in 0043's own header comment) and
--     is explicitly NOT reused for this, per the spec's own "supplier
--     payment is settlement of a LIABILITY, not an expense" rule.
--   - No existing supplier-payment or GRN-allocation table exists, so
--     the two new tables below are genuinely new domain tables (not
--     ledger tables - the ledger schema itself, clinic_ledger_accounts/
--     _settings/_transactions/_entries/_reconciliation_issues and the
--     _post_ledger_transaction core, is entirely unchanged by this
--     migration except for widening one existing unique index's value
--     list, exactly as instructed).
--
-- This migration reuses _post_ledger_transaction (0043) directly for
-- every posting - there is no second posting mechanism anywhere here.
-- record_supplier_payment validates everything (supplier ownership,
-- GRN ownership, no over-allocation, allocations sum to the payment
-- amount exactly) and posts atomically in one plpgsql function, so a
-- supplier payment and its ledger entry can never exist independently of
-- each other. void_supplier_payment reuses the EXISTING
-- reverse_ledger_transaction RPC (0043) rather than reimplementing
-- reversal.
--
-- Safe to re-run: create table/index if not exists, drop policy/
-- function + recreate, matching every other migration.
-- ============================================================

/* ============================================================ */
/* 1. Supplier payments + GRN allocations                        */
/* ============================================================ */

create table if not exists public.clinic_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  supplier_id uuid not null references public.clinic_suppliers(id) on delete restrict,

  payment_date date not null,
  payment_method text not null,
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  notes text,

  status text not null default 'Posted' check (status in ('Posted', 'Voided')),
  voided_at timestamptz,
  voided_by uuid references public.clinic_users(id) on delete set null,
  void_reason text,

  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinic_supplier_payments_clinic_id
  on public.clinic_supplier_payments(clinic_id);
create index if not exists idx_clinic_supplier_payments_supplier_id
  on public.clinic_supplier_payments(clinic_id, supplier_id);
create index if not exists idx_clinic_supplier_payments_date
  on public.clinic_supplier_payments(clinic_id, payment_date);

alter table public.clinic_supplier_payments enable row level security;

drop policy if exists "clinic_supplier_payments_select_own_clinic" on public.clinic_supplier_payments;
create policy "clinic_supplier_payments_select_own_clinic"
  on public.clinic_supplier_payments for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_supplier_payments.clinic_id
    )
  );

-- Deliberately NO insert/update/delete policy for regular clients -
-- every write happens through record_supplier_payment/
-- void_supplier_payment below, matching the ledger's own "no direct
-- client writes, RPC-only" model from 0043.

create table if not exists public.clinic_supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  supplier_payment_id uuid not null references public.clinic_supplier_payments(id) on delete cascade,
  grn_id uuid not null references public.clinic_goods_received_notes(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_supplier_payment_allocations_clinic_id
  on public.clinic_supplier_payment_allocations(clinic_id);
create index if not exists idx_clinic_supplier_payment_allocations_payment_id
  on public.clinic_supplier_payment_allocations(supplier_payment_id);
create index if not exists idx_clinic_supplier_payment_allocations_grn_id
  on public.clinic_supplier_payment_allocations(grn_id);

alter table public.clinic_supplier_payment_allocations enable row level security;

drop policy if exists "clinic_supplier_payment_allocations_select_own_clinic" on public.clinic_supplier_payment_allocations;
create policy "clinic_supplier_payment_allocations_select_own_clinic"
  on public.clinic_supplier_payment_allocations for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_supplier_payment_allocations.clinic_id
    )
  );

/* ============================================================ */
/* 2. Extend the existing duplicate-posting backstop (section 9)  */
/* ============================================================ */

drop index if exists idx_clinic_ledger_transactions_reference_unique;
create unique index if not exists idx_clinic_ledger_transactions_reference_unique
  on public.clinic_ledger_transactions(clinic_id, reference_type, reference_id)
  where reference_type in (
    'invoice', 'payment', 'expense', 'expense_void', 'grn', 'inventory_movement',
    'supplier_payment', 'supplier_payment_void'
  );

/* ============================================================ */
/* 3. Record a supplier payment - validates, inserts, and posts   */
/*    atomically in one function (section 6/9/17). Owner/Admin.   */
/* ============================================================ */

create or replace function public.record_supplier_payment(
  p_supplier_id uuid,
  p_payment_date date,
  p_payment_method text,
  p_amount numeric,
  p_allocations jsonb,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_supplier record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_cash_account_id uuid;
  v_payment_id uuid;
  v_transaction_id uuid;
  v_allocation jsonb;
  v_grn_id uuid;
  v_alloc_amount numeric;
  v_allocated_total numeric := 0;
  v_grn_total numeric;
  v_grn_already_paid numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can record supplier payments';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  select * into v_supplier from public.clinic_suppliers s
  where s.id = p_supplier_id and s.clinic_id = v_clinic_id;

  if v_supplier.id is null then
    raise exception 'Supplier not found for this clinic';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Select at least one outstanding GRN to apply this payment against';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.accounts_payable_account_id is null then
    raise exception 'Accounts Payable account is not configured - set it in Accounting Settings first';
  end if;

  v_cash_account_id := coalesce(
    (v_settings.payment_method_accounts ->> p_payment_method)::uuid,
    v_settings.default_cash_account_id
  );

  if v_cash_account_id is null then
    raise exception 'No account is configured for payment method "%" - set a default cash account in Accounting Settings', p_payment_method;
  end if;

  -- Validate every allocation line BEFORE writing anything: each GRN
  -- must belong to this supplier/clinic and be Received, and the
  -- allocation must not exceed that GRN's real-time outstanding balance
  -- (section 6 - reject overpayment rather than inventing a credit
  -- balance concept). Locking each GRN row serializes this against a
  -- concurrent payment being recorded against the same GRN.
  for v_allocation in select * from jsonb_array_elements(p_allocations) loop
    v_grn_id := (v_allocation->>'grn_id')::uuid;
    v_alloc_amount := (v_allocation->>'amount')::numeric;

    if v_grn_id is null or v_alloc_amount is null or v_alloc_amount <= 0 then
      raise exception 'Each allocation must have a valid GRN and a positive amount';
    end if;

    perform 1 from public.clinic_goods_received_notes g
    where g.id = v_grn_id and g.clinic_id = v_clinic_id and g.supplier_id = p_supplier_id
      and g.status = 'Received'
    for update;

    if not found then
      raise exception 'GRN not found, not received, or does not belong to this supplier';
    end if;

    select coalesce(sum(gi.quantity_received * gi.unit_cost), 0) into v_grn_total
    from public.clinic_grn_items gi
    where gi.grn_id = v_grn_id;

    select coalesce(sum(a.amount), 0) into v_grn_already_paid
    from public.clinic_supplier_payment_allocations a
    join public.clinic_supplier_payments p on p.id = a.supplier_payment_id
    where a.grn_id = v_grn_id and p.status = 'Posted';

    if v_alloc_amount > (v_grn_total - v_grn_already_paid) then
      raise exception 'Allocation of % exceeds the outstanding balance of % for this GRN', v_alloc_amount, (v_grn_total - v_grn_already_paid);
    end if;

    v_allocated_total := v_allocated_total + v_alloc_amount;
  end loop;

  -- Every kobo/cent of the payment must be allocated - there is no
  -- "unapplied supplier credit" account in this system, so a payment
  -- that doesn't fully allocate would leave money nowhere accounted for.
  if v_allocated_total <> p_amount then
    raise exception 'Allocations (%) must add up to exactly the payment amount (%)', v_allocated_total, p_amount;
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  insert into public.clinic_supplier_payments (
    clinic_id, supplier_id, payment_date, payment_method, amount, reference, notes, created_by
  )
  values (
    v_clinic_id, p_supplier_id, p_payment_date, p_payment_method, p_amount, p_reference, p_notes, v_clinic_user_id
  )
  returning id into v_payment_id;

  insert into public.clinic_supplier_payment_allocations (clinic_id, supplier_payment_id, grn_id, amount)
  select
    v_clinic_id,
    v_payment_id,
    (entry->>'grn_id')::uuid,
    (entry->>'amount')::numeric
  from jsonb_array_elements(p_allocations) as entry;

  v_transaction_id := public._post_ledger_transaction(
    v_clinic_id, p_payment_date, 'Payment', 'supplier_payment', v_payment_id,
    'Supplier payment: ' || v_supplier.name
      || case when p_reference is not null and trim(p_reference) <> '' then ' (Ref: ' || trim(p_reference) || ')' else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.accounts_payable_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_cash_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, p_supplier_id, v_clinic_user_id, null
  );

  return v_payment_id;
end;
$$;

grant execute on function public.record_supplier_payment(uuid, date, text, numeric, jsonb, text, text) to authenticated;

/* ============================================================ */
/* 4. Void a supplier payment (section 10) - reuses the EXISTING  */
/*    reverse_ledger_transaction RPC rather than reimplementing   */
/*    reversal. Owner/Admin.                                      */
/* ============================================================ */

create or replace function public.void_supplier_payment(
  p_payment_id uuid,
  p_reason text default null
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
  v_clinic_user_id uuid;
  v_payment record;
  v_transaction_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can void supplier payments';
  end if;

  select * into v_payment from public.clinic_supplier_payments p
  where p.id = p_payment_id and p.clinic_id = v_clinic_id
  for update;

  if v_payment.id is null then
    raise exception 'Supplier payment not found for this clinic';
  end if;

  if v_payment.status = 'Voided' then
    raise exception 'This payment has already been voided';
  end if;

  select t.id into v_transaction_id from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.reference_type = 'supplier_payment' and t.reference_id = p_payment_id
    and t.reversed_by is null;

  update public.clinic_supplier_payments
  set status = 'Voided', voided_at = now(), voided_by = v_clinic_user_id, void_reason = p_reason, updated_at = now()
  where id = p_payment_id;

  if v_transaction_id is not null then
    perform public.reverse_ledger_transaction(v_transaction_id, coalesce(p_reason, 'Supplier payment voided'));
  end if;
end;
$$;

grant execute on function public.void_supplier_payment(uuid, text) to authenticated;

/* ============================================================ */
/* 5. Read functions - plain SQL, security invoker (RLS-scoped     */
/*    for free), matching 0043's trial-balance/account-ledger      */
/*    pattern exactly, avoiding the plpgsql RETURNS TABLE column-  */
/*    shadowing bug class entirely.                                */
/* ============================================================ */

create or replace function public.get_supplier_outstanding_grns(p_supplier_id uuid)
returns table (
  grn_id uuid,
  grn_number text,
  date_received date,
  total_amount numeric,
  paid_amount numeric,
  outstanding_amount numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    g.id,
    g.grn_number,
    g.date_received,
    coalesce(item_totals.total, 0),
    coalesce(paid.total, 0),
    coalesce(item_totals.total, 0) - coalesce(paid.total, 0)
  from public.clinic_goods_received_notes g
  left join (
    select gi.grn_id, sum(gi.quantity_received * gi.unit_cost) as total
    from public.clinic_grn_items gi
    group by gi.grn_id
  ) item_totals on item_totals.grn_id = g.id
  left join (
    select a.grn_id, sum(a.amount) as total
    from public.clinic_supplier_payment_allocations a
    join public.clinic_supplier_payments p on p.id = a.supplier_payment_id
    where p.status = 'Posted'
    group by a.grn_id
  ) paid on paid.grn_id = g.id
  where g.supplier_id = p_supplier_id and g.status = 'Received'
  order by g.date_received;
$$;

grant execute on function public.get_supplier_outstanding_grns(uuid) to authenticated;

create or replace function public.get_supplier_ap_summary()
returns table (
  supplier_id uuid,
  supplier_name text,
  total_purchases numeric,
  total_paid numeric,
  outstanding numeric,
  last_payment_date date
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    s.id,
    s.name,
    coalesce(purchases.total, 0),
    coalesce(payments.total, 0),
    coalesce(purchases.total, 0) - coalesce(payments.total, 0),
    payments.last_date
  from public.clinic_suppliers s
  left join (
    select g.supplier_id, sum(gi.quantity_received * gi.unit_cost) as total
    from public.clinic_goods_received_notes g
    join public.clinic_grn_items gi on gi.grn_id = g.id
    where g.status = 'Received'
    group by g.supplier_id
  ) purchases on purchases.supplier_id = s.id
  left join (
    select p.supplier_id, sum(p.amount) as total, max(p.payment_date) as last_date
    from public.clinic_supplier_payments p
    where p.status = 'Posted'
    group by p.supplier_id
  ) payments on payments.supplier_id = s.id
  where purchases.total is not null or payments.total is not null
  order by s.name;
$$;

grant execute on function public.get_supplier_ap_summary() to authenticated;

-- Reconciliation (section 16): the true, ledger-derived A/P balance for
-- one supplier - independently computed from clinic_ledger_entries
-- rather than from clinic_grn_items/clinic_supplier_payment_allocations,
-- so the application layer can compare the two and surface a clear
-- warning if they ever disagree instead of silently trusting one.
create or replace function public.get_supplier_ledger_ap_balance(p_supplier_id uuid)
returns numeric
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(sum(e.credit - e.debit), 0)
  from public.clinic_ledger_entries e
  join public.clinic_ledger_transactions t on t.id = e.transaction_id
  where t.supplier_id = p_supplier_id
    and e.account_id = (
      select ls.accounts_payable_account_id from public.clinic_ledger_settings ls
      where ls.clinic_id = (
        select cu.clinic_id from public.clinic_users cu where cu.auth_user_id = auth.uid() limit 1
      )
    );
$$;

grant execute on function public.get_supplier_ledger_ap_balance(uuid) to authenticated;
