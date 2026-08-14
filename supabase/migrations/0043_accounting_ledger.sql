-- ============================================================
-- Accounting Ledger System.
--
-- AUDIT FINDINGS (before writing this):
--   - Authoritative financial events already exist and are NOT duplicated
--     here: clinic_invoices (revenue recognized at creation),
--     clinic_payments (cash received - no dentist link, no created_by
--     column, both already-documented limitations from the Reports
--     Center round), clinic_expenses (Money Out, category_id NOT NULL,
--     status Paid/Voided, HAS created_by), clinic_goods_received_notes /
--     clinic_grn_items (confirm_grn_receipt is the only path that posts
--     received stock+cost into clinic_inventory_items - migrations
--     0025/0027/0042), clinic_inventory_movements (the existing
--     immutable, SELECT+INSERT-only audit trail from migration 0012,
--     extended in 0042 with unit_cost/batch_number/supplier_id/patient_id
--     /treatment_id).
--   - No "accounts payable" concept exists anywhere today: a GRN receipt
--     and a Money Out expense against a supplier are two fully DECOUPLED
--     events (an expense never references a specific GRN). This ledger
--     DOES post GRN receipts to Accounts Payable (goods received on
--     account is what physically happened), but Money Out expenses never
--     automatically debit Accounts Payable - there is no reliable link
--     to know which expense pays down which GRN. Paying down Accounts
--     Payable currently requires a manual journal entry until Money Out
--     gains a "pay against GRN" action - documented in the final report,
--     not silently pretended away.
--   - No refund concept exists anywhere (clinic_payments has no negative
--     rows, clinic_invoices has no Refunded status) - not implemented
--     since there is nothing real to post.
--
-- SAFETY DESIGN (the most important decision in this file):
-- clinic_invoices/clinic_payments/clinic_expenses/clinic_goods_received_
-- notes are live tables with existing application code that must keep
-- working exactly as before. Automatic posting is implemented as AFTER
-- triggers - zero lines of services/billing.ts, services/expenses.ts, or
-- the GRN RPC are touched - and every trigger function wraps its posting
-- logic in EXCEPTION WHEN OTHERS so a bug or edge case in ledger posting
-- can NEVER block or roll back the underlying invoice/payment/expense/GRN
-- operation itself. The real financial operation always succeeds; if its
-- ledger entry fails, that failure is recorded as a visible
-- reconciliation issue (clinic_ledger_reconciliation_issues) rather than
-- silently lost or allowed to write a partial entry.
--
-- Safe to re-run: create table/index if not exists, drop policy/
-- trigger/function + recreate, matching every other migration.
-- ============================================================

/* ============================================================ */
/* 1. Chart of Accounts                                          */
/* ============================================================ */

create table if not exists public.clinic_ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,

  code text not null,
  name text not null,
  type text not null check (type in ('Asset', 'Liability', 'Equity', 'Income', 'Expense')),
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (clinic_id, code)
);

create index if not exists idx_clinic_ledger_accounts_clinic_id
  on public.clinic_ledger_accounts(clinic_id);

alter table public.clinic_ledger_accounts enable row level security;

drop policy if exists "clinic_ledger_accounts_select_own_clinic" on public.clinic_ledger_accounts;
create policy "clinic_ledger_accounts_select_own_clinic"
  on public.clinic_ledger_accounts for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_accounts.clinic_id
    )
  );

-- Accounts are Owner/Admin-manageable (matches "ledger_manage" being
-- Owner/Admin-only in lib/permissions.ts) - deliberately no DELETE policy
-- anywhere in this file: an account must never be hard-deleted (section
-- 5), only deactivated via UPDATE.
drop policy if exists "clinic_ledger_accounts_insert_managers" on public.clinic_ledger_accounts;
create policy "clinic_ledger_accounts_insert_managers"
  on public.clinic_ledger_accounts for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_accounts.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

drop policy if exists "clinic_ledger_accounts_update_managers" on public.clinic_ledger_accounts;
create policy "clinic_ledger_accounts_update_managers"
  on public.clinic_ledger_accounts for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_accounts.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_accounts.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

/* ============================================================ */
/* 2. Default account mappings + payment-method accounts         */
/* ============================================================ */

create table if not exists public.clinic_ledger_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,

  treatment_revenue_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  accounts_receivable_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  inventory_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  accounts_payable_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  supplies_used_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  default_expense_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  default_cash_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,
  opening_balance_equity_account_id uuid references public.clinic_ledger_accounts(id) on delete set null,

  -- {"Cash": "<account_id>", "M-Pesa": "<account_id>", ...} - payment
  -- methods are free text everywhere else in this app (no fixed enum
  -- table to join against), so this is deliberately flexible rather than
  -- a rigid per-method column.
  payment_method_accounts jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now()
);

alter table public.clinic_ledger_settings enable row level security;

drop policy if exists "clinic_ledger_settings_select_own_clinic" on public.clinic_ledger_settings;
create policy "clinic_ledger_settings_select_own_clinic"
  on public.clinic_ledger_settings for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_settings.clinic_id
    )
  );

drop policy if exists "clinic_ledger_settings_update_managers" on public.clinic_ledger_settings;
create policy "clinic_ledger_settings_update_managers"
  on public.clinic_ledger_settings for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_settings.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_settings.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

-- Money Out categories are already clinic-customizable
-- (clinic_expense_categories) - reusing that existing table's own
-- natural extension point for "which account does this category post
-- to" rather than inventing a parallel generic mapping table.
alter table public.clinic_expense_categories
  add column if not exists default_ledger_account_id uuid
    references public.clinic_ledger_accounts(id) on delete set null;

/* ============================================================ */
/* 3. Journal: transactions (header) + entries (debit/credit lines) */
/* ============================================================ */

create table if not exists public.clinic_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,

  transaction_date date not null,
  transaction_type text not null check (
    transaction_type in (
      'Invoice', 'Payment', 'Expense', 'InventoryReceipt', 'InventoryConsumption',
      'InventoryReturn', 'ManualJournal', 'Reversal', 'OpeningBalance'
    )
  ),

  -- Points back at the ONE authoritative source record for automatic
  -- postings. Deliberately the only source-record reference on this
  -- table (not a separate nullable FK per possible source table) -
  -- patient_id/supplier_id below exist only because they're needed for
  -- direct report filtering; every other "related document" is already
  -- fully recoverable via reference_type + reference_id.
  reference_type text,
  reference_id uuid,

  description text not null,
  currency text not null,

  patient_id uuid references public.patients(id) on delete set null,
  supplier_id uuid references public.clinic_suppliers(id) on delete set null,

  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Reversal linkage (section 14): a transaction that reverses another
  -- points at it; the reversed transaction's own reversed_by is set so
  -- either row shows the full relationship both directions.
  reverses_transaction_id uuid references public.clinic_ledger_transactions(id) on delete set null,
  reversed_by uuid references public.clinic_ledger_transactions(id) on delete set null
);

create index if not exists idx_clinic_ledger_transactions_clinic_id
  on public.clinic_ledger_transactions(clinic_id);
create index if not exists idx_clinic_ledger_transactions_date
  on public.clinic_ledger_transactions(clinic_id, transaction_date);
create index if not exists idx_clinic_ledger_transactions_reference_lookup
  on public.clinic_ledger_transactions(clinic_id, reference_type, reference_id);
create index if not exists idx_clinic_ledger_transactions_created_at
  on public.clinic_ledger_transactions(clinic_id, created_at);

-- Duplicate-posting backstop (section 25), scoped only to the
-- exactly-once-per-source-event automatic postings. Manual journal
-- entries, reversals, and opening balances are legitimately
-- user-repeatable and are governed by their own procedural "at most one
-- active" checks in the RPCs that create them instead.
create unique index if not exists idx_clinic_ledger_transactions_reference_unique
  on public.clinic_ledger_transactions(clinic_id, reference_type, reference_id)
  where reference_type in ('invoice', 'payment', 'expense', 'expense_void', 'grn', 'inventory_movement');

alter table public.clinic_ledger_transactions enable row level security;

drop policy if exists "clinic_ledger_transactions_select_own_clinic" on public.clinic_ledger_transactions;
create policy "clinic_ledger_transactions_select_own_clinic"
  on public.clinic_ledger_transactions for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_transactions.clinic_id
    )
  );

-- Deliberately NO insert/update/delete policy for regular clients: every
-- write happens through security-definer functions (triggers,
-- create_manual_journal_entry, reverse_ledger_transaction,
-- set_opening_balance) so the balance-check invariant (section 13) can
-- never be bypassed by a direct client insert.

create table if not exists public.clinic_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  transaction_id uuid not null references public.clinic_ledger_transactions(id) on delete cascade,
  account_id uuid not null references public.clinic_ledger_accounts(id) on delete restrict,

  debit numeric(12, 2) not null default 0 check (debit >= 0),
  credit numeric(12, 2) not null default 0 check (credit >= 0),
  check (not (debit > 0 and credit > 0)),
  check (debit > 0 or credit > 0),

  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_ledger_entries_clinic_id
  on public.clinic_ledger_entries(clinic_id);
create index if not exists idx_clinic_ledger_entries_transaction_id
  on public.clinic_ledger_entries(transaction_id);
create index if not exists idx_clinic_ledger_entries_account_id
  on public.clinic_ledger_entries(clinic_id, account_id);

alter table public.clinic_ledger_entries enable row level security;

drop policy if exists "clinic_ledger_entries_select_own_clinic" on public.clinic_ledger_entries;
create policy "clinic_ledger_entries_select_own_clinic"
  on public.clinic_ledger_entries for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_entries.clinic_id
    )
  );

/* ============================================================ */
/* 4. Reconciliation issues (section 26)                         */
/* ============================================================ */

create table if not exists public.clinic_ledger_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  reference_type text not null,
  reference_id uuid,
  issue text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_ledger_reconciliation_issues_clinic_id
  on public.clinic_ledger_reconciliation_issues(clinic_id, resolved);

alter table public.clinic_ledger_reconciliation_issues enable row level security;

drop policy if exists "clinic_ledger_reconciliation_issues_select_own_clinic" on public.clinic_ledger_reconciliation_issues;
create policy "clinic_ledger_reconciliation_issues_select_own_clinic"
  on public.clinic_ledger_reconciliation_issues for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_ledger_reconciliation_issues.clinic_id
    )
  );

/* ============================================================ */
/* 5. Balanced-posting core - the ONE place debit=credit is       */
/*    enforced (section 13). Not granted to `authenticated` -     */
/*    only ever called from other security-definer functions.    */
/* ============================================================ */

create or replace function public._post_ledger_transaction(
  p_clinic_id uuid,
  p_transaction_date date,
  p_transaction_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_description text,
  p_currency text,
  p_entries jsonb,
  p_patient_id uuid default null,
  p_supplier_id uuid default null,
  p_created_by uuid default null,
  p_reverses_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_entry jsonb;
  v_debit numeric;
  v_credit numeric;
begin
  if p_entries is null or jsonb_array_length(p_entries) < 2 then
    raise exception 'A ledger transaction requires at least two entry lines';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_debit := coalesce((v_entry->>'debit')::numeric, 0);
    v_credit := coalesce((v_entry->>'credit')::numeric, 0);

    if v_debit > 0 and v_credit > 0 then
      raise exception 'A single ledger entry line cannot carry both a debit and a credit';
    end if;

    if v_debit = 0 and v_credit = 0 then
      raise exception 'Each ledger entry line must have a non-zero debit or credit';
    end if;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Ledger transaction does not balance: total debits % != total credits %', v_total_debit, v_total_credit;
  end if;

  if v_total_debit <= 0 then
    raise exception 'Ledger transaction has zero value';
  end if;

  insert into public.clinic_ledger_transactions (
    clinic_id, transaction_date, transaction_type, reference_type, reference_id,
    description, currency, patient_id, supplier_id, created_by, reverses_transaction_id
  )
  values (
    p_clinic_id, p_transaction_date, p_transaction_type, p_reference_type, p_reference_id,
    p_description, p_currency, p_patient_id, p_supplier_id, p_created_by, p_reverses_transaction_id
  )
  returning id into v_transaction_id;

  insert into public.clinic_ledger_entries (clinic_id, transaction_id, account_id, debit, credit)
  select
    p_clinic_id,
    v_transaction_id,
    (entry->>'account_id')::uuid,
    coalesce((entry->>'debit')::numeric, 0),
    coalesce((entry->>'credit')::numeric, 0)
  from jsonb_array_elements(p_entries) as entry;

  return v_transaction_id;
end;
$$;

/* ============================================================ */
/* 6. Provisioning: seed the default Chart of Accounts + settings */
/*    for a clinic the first time it's needed - lazy, idempotent, */
/*    same pattern already used by switch_active_branch's lazy    */
/*    clinic_users provisioning elsewhere in this project.        */
/* ============================================================ */

create or replace function public._ensure_ledger_provisioned_for_clinic(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash uuid; v_bank uuid; v_mpesa uuid; v_ar uuid; v_inventory uuid;
  v_ap uuid; v_obe uuid; v_revenue uuid; v_other_expense uuid; v_supplies_used uuid;
begin
  if exists (select 1 from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id) then
    return;
  end if;

  insert into public.clinic_ledger_accounts (clinic_id, code, name, type) values
    (p_clinic_id, '1000', 'Cash', 'Asset'),
    (p_clinic_id, '1010', 'Bank', 'Asset'),
    (p_clinic_id, '1020', 'M-Pesa / Mobile Money', 'Asset'),
    (p_clinic_id, '1100', 'Accounts Receivable', 'Asset'),
    (p_clinic_id, '1200', 'Inventory', 'Asset'),
    (p_clinic_id, '1900', 'Other Current Assets', 'Asset'),
    (p_clinic_id, '2000', 'Accounts Payable', 'Liability'),
    (p_clinic_id, '2900', 'Other Current Liabilities', 'Liability'),
    (p_clinic_id, '3000', 'Owner''s Equity', 'Equity'),
    (p_clinic_id, '3100', 'Opening Balance Equity', 'Equity'),
    (p_clinic_id, '4000', 'Treatment Revenue', 'Income'),
    (p_clinic_id, '4900', 'Other Income', 'Income'),
    (p_clinic_id, '5000', 'Salaries', 'Expense'),
    (p_clinic_id, '5010', 'Rent', 'Expense'),
    (p_clinic_id, '5020', 'Utilities', 'Expense'),
    (p_clinic_id, '5030', 'Dental Supplies', 'Expense'),
    (p_clinic_id, '5040', 'Laboratory', 'Expense'),
    (p_clinic_id, '5050', 'Marketing', 'Expense'),
    (p_clinic_id, '5060', 'Software', 'Expense'),
    (p_clinic_id, '5070', 'Insurance', 'Expense'),
    (p_clinic_id, '5080', 'Repairs & Maintenance', 'Expense'),
    (p_clinic_id, '5090', 'Transport', 'Expense'),
    (p_clinic_id, '5100', 'Professional Fees', 'Expense'),
    (p_clinic_id, '5200', 'Supplies Used', 'Expense'),
    (p_clinic_id, '5900', 'Other Expenses', 'Expense');

  select a.id into v_cash from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '1000';
  select a.id into v_bank from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '1010';
  select a.id into v_mpesa from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '1020';
  select a.id into v_ar from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '1100';
  select a.id into v_inventory from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '1200';
  select a.id into v_ap from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '2000';
  select a.id into v_obe from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '3100';
  select a.id into v_revenue from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '4000';
  select a.id into v_other_expense from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5900';
  select a.id into v_supplies_used from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5200';

  insert into public.clinic_ledger_settings (
    clinic_id, treatment_revenue_account_id, accounts_receivable_account_id,
    inventory_account_id, accounts_payable_account_id, supplies_used_account_id,
    default_expense_account_id, default_cash_account_id, opening_balance_equity_account_id,
    payment_method_accounts
  )
  values (
    p_clinic_id, v_revenue, v_ar, v_inventory, v_ap, v_supplies_used,
    v_other_expense, v_cash, v_obe,
    jsonb_build_object('Cash', v_cash, 'Bank Transfer', v_bank, 'M-Pesa', v_mpesa)
  )
  on conflict (clinic_id) do nothing;
end;
$$;

create or replace function public.ensure_ledger_provisioned()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id into v_clinic_id from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
end;
$$;

grant execute on function public.ensure_ledger_provisioned() to authenticated;

/* ============================================================ */
/* 7. Reversal helper - flips every entry line of an existing     */
/*    transaction, used by both the expense-void trigger and the  */
/*    manual reverse_ledger_transaction RPC (section 14).         */
/* ============================================================ */

create or replace function public._build_reversal_entries(p_transaction_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_agg(jsonb_build_object('account_id', e.account_id, 'debit', e.credit, 'credit', e.debit))
  from public.clinic_ledger_entries e
  where e.transaction_id = p_transaction_id;
$$;

/* ============================================================ */
/* 8. Automatic posting: Invoice created -> revenue recognized    */
/* ============================================================ */

create or replace function public._trigger_post_invoice_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
begin
  if NEW.total is null or NEW.total <= 0 then
    return NEW;
  end if;

  begin
    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    if v_settings.accounts_receivable_account_id is null or v_settings.treatment_revenue_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'invoice', NEW.id, 'Accounts Receivable or Treatment Revenue account is not configured.');
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.created_at::date, 'Invoice', 'invoice', NEW.id,
      'Invoice ' || NEW.invoice_number, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', NEW.total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.treatment_revenue_account_id, 'debit', 0, 'credit', NEW.total)
      ),
      NEW.patient_id, null, null, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'invoice', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_post_invoice_ledger on public.clinic_invoices;
create trigger trg_post_invoice_ledger
  after insert on public.clinic_invoices
  for each row execute function public._trigger_post_invoice_ledger();

/* ============================================================ */
/* 9. Automatic posting: Payment received -> cash up, A/R down    */
/* ============================================================ */

create or replace function public._trigger_post_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_cash_account_id uuid;
begin
  if NEW.amount is null or NEW.amount <= 0 then
    return NEW;
  end if;

  begin
    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    v_cash_account_id := coalesce(
      (v_settings.payment_method_accounts ->> NEW.payment_method)::uuid,
      v_settings.default_cash_account_id
    );

    if v_cash_account_id is null or v_settings.accounts_receivable_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (
        NEW.clinic_id, 'payment', NEW.id,
        'No account configured for payment method "' || NEW.payment_method || '" or Accounts Receivable.'
      );
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.received_at::date, 'Payment', 'payment', NEW.id,
      'Payment received via ' || NEW.payment_method, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash_account_id, 'debit', NEW.amount, 'credit', 0),
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', 0, 'credit', NEW.amount)
      ),
      NEW.patient_id, null, null, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'payment', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_post_payment_ledger on public.clinic_payments;
create trigger trg_post_payment_ledger
  after insert on public.clinic_payments
  for each row execute function public._trigger_post_payment_ledger();

/* ============================================================ */
/* 10. Automatic posting: Money Out expense, and its reversal     */
/*     when voided (sections 7, 14)                               */
/* ============================================================ */

create or replace function public._trigger_post_expense_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
begin
  if NEW.amount is null or NEW.amount <= 0 then
    return NEW;
  end if;

  begin
    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    select coalesce(c.default_ledger_account_id, v_settings.default_expense_account_id)
    into v_debit_account_id
    from public.clinic_expense_categories c
    where c.id = NEW.category_id;

    v_debit_account_id := coalesce(v_debit_account_id, v_settings.default_expense_account_id);

    v_credit_account_id := coalesce(
      (v_settings.payment_method_accounts ->> NEW.payment_method)::uuid,
      v_settings.default_cash_account_id
    );

    if v_debit_account_id is null or v_credit_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'expense', NEW.id, 'No expense or cash/bank account configured to post this Money Out entry.');
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.expense_date, 'Expense', 'expense', NEW.id,
      NEW.description, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_debit_account_id, 'debit', NEW.amount, 'credit', 0),
        jsonb_build_object('account_id', v_credit_account_id, 'debit', 0, 'credit', NEW.amount)
      ),
      null, NEW.supplier_id, NEW.created_by, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'expense', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_post_expense_ledger on public.clinic_expenses;
create trigger trg_post_expense_ledger
  after insert on public.clinic_expenses
  for each row execute function public._trigger_post_expense_ledger();

create or replace function public._trigger_reverse_voided_expense_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original record;
  v_entries jsonb;
  v_new_id uuid;
begin
  if NEW.status <> 'Voided' or OLD.status is not distinct from 'Voided' then
    return NEW;
  end if;

  begin
    select * into v_original from public.clinic_ledger_transactions t
    where t.clinic_id = NEW.clinic_id and t.reference_type = 'expense' and t.reference_id = NEW.id
      and t.reversed_by is null;

    if v_original.id is null then
      return NEW; -- nothing was ever posted for this expense - nothing to reverse
    end if;

    v_entries := public._build_reversal_entries(v_original.id);

    v_new_id := public._post_ledger_transaction(
      NEW.clinic_id, current_date, 'Reversal', 'expense_void', NEW.id,
      'Reversal: voided expense "' || NEW.description || '"', v_original.currency,
      v_entries, v_original.patient_id, v_original.supplier_id, NEW.voided_by, v_original.id
    );

    update public.clinic_ledger_transactions set reversed_by = v_new_id where id = v_original.id;
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'expense_void', NEW.id, 'Ledger reversal failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_reverse_voided_expense_ledger on public.clinic_expenses;
create trigger trg_reverse_voided_expense_ledger
  after update on public.clinic_expenses
  for each row execute function public._trigger_reverse_voided_expense_ledger();

/* ============================================================ */
/* 11. Automatic posting: GRN received -> inventory up, A/P up    */
/* ============================================================ */

create or replace function public._trigger_post_grn_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_total numeric;
begin
  if NEW.status <> 'Received' or OLD.status is not distinct from 'Received' then
    return NEW;
  end if;

  begin
    select coalesce(sum(gi.quantity_received * gi.unit_cost), 0) into v_total
    from public.clinic_grn_items gi
    where gi.grn_id = NEW.id;

    if v_total <= 0 then
      return NEW;
    end if;

    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    if v_settings.inventory_account_id is null or v_settings.accounts_payable_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'grn', NEW.id, 'Inventory or Accounts Payable account is not configured.');
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.date_received, 'InventoryReceipt', 'grn', NEW.id,
      'Goods received: ' || NEW.grn_number, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.inventory_account_id, 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.accounts_payable_account_id, 'debit', 0, 'credit', v_total)
      ),
      null, NEW.supplier_id, NEW.received_by, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'grn', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_post_grn_ledger on public.clinic_goods_received_notes;
create trigger trg_post_grn_ledger
  after update on public.clinic_goods_received_notes
  for each row execute function public._trigger_post_grn_ledger();

/* ============================================================ */
/* 12. Automatic posting: inventory consumed/damaged/expired/     */
/*     returned to supplier -> reliable cost basis only (section  */
/*     8). Manual restocks/corrections/initial stock are NOT      */
/*     auto-posted - they represent a physical count change with  */
/*     no real, known funding source to balance against, so       */
/*     inventing one would be exactly the kind of fabrication the */
/*     spec forbids. GRN-sourced restocks are already fully       */
/*     covered by the GRN trigger above and are explicitly        */
/*     excluded here to avoid double-posting the same receipt.    */
/* ============================================================ */

create or replace function public._trigger_post_inventory_consumption_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_unit_cost numeric;
  v_total numeric;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_transaction_type text;
begin
  if NEW.movement_type <> 'Decrease' or NEW.reason not in ('Used', 'Damaged', 'Expired', 'Returned to Supplier') then
    return NEW;
  end if;

  begin
    v_unit_cost := coalesce(
      NEW.unit_cost,
      (select ii.cost_per_unit from public.clinic_inventory_items ii where ii.id = NEW.inventory_item_id)
    );

    v_total := abs(NEW.quantity_change) * coalesce(v_unit_cost, 0);

    if v_total <= 0 then
      return NEW;
    end if;

    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    if NEW.reason = 'Returned to Supplier' then
      v_debit_account_id := v_settings.accounts_payable_account_id;
      v_credit_account_id := v_settings.inventory_account_id;
      v_transaction_type := 'InventoryReturn';
    else
      v_debit_account_id := v_settings.supplies_used_account_id;
      v_credit_account_id := v_settings.inventory_account_id;
      v_transaction_type := 'InventoryConsumption';
    end if;

    if v_debit_account_id is null or v_credit_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'inventory_movement', NEW.id, 'Inventory, Supplies Used, or Accounts Payable account is not configured.');
      return NEW;
    end if;

    select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.created_at::date, v_transaction_type, 'inventory_movement', NEW.id,
      NEW.reason || ': ' || abs(NEW.quantity_change) || ' units', coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_debit_account_id, 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_id', v_credit_account_id, 'debit', 0, 'credit', v_total)
      ),
      NEW.patient_id, NEW.supplier_id, NEW.created_by, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'inventory_movement', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_post_inventory_consumption_ledger on public.clinic_inventory_movements;
create trigger trg_post_inventory_consumption_ledger
  after insert on public.clinic_inventory_movements
  for each row execute function public._trigger_post_inventory_consumption_ledger();

/* ============================================================ */
/* 13. Manual journal entries (section 15) - Owner/Admin only,    */
/*     one debit account + one credit account, always balanced   */
/*     by construction.                                           */
/* ============================================================ */

create or replace function public.create_manual_journal_entry(
  p_transaction_date date,
  p_description text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
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
  v_currency text;
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
    raise exception 'Only Owner/Admin can create manual journal entries';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  if p_debit_account_id = p_credit_account_id then
    raise exception 'Debit and credit accounts must be different';
  end if;

  if not exists (
    select 1 from public.clinic_ledger_accounts a
    where a.id = p_debit_account_id and a.clinic_id = v_clinic_id and a.active
  ) then
    raise exception 'Debit account not found for this clinic';
  end if;

  if not exists (
    select 1 from public.clinic_ledger_accounts a
    where a.id = p_credit_account_id and a.clinic_id = v_clinic_id and a.active
  ) then
    raise exception 'Credit account not found for this clinic';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  return public._post_ledger_transaction(
    v_clinic_id, p_transaction_date, 'ManualJournal', 'manual', null,
    coalesce(nullif(trim(p_description), ''), 'Manual journal entry')
      || case when p_notes is not null and trim(p_notes) <> '' then ' - ' || trim(p_notes) else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', p_debit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', p_credit_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, null, v_clinic_user_id, null
  );
end;
$$;

grant execute on function public.create_manual_journal_entry(date, text, uuid, uuid, numeric, text) to authenticated;

/* ============================================================ */
/* 14. Reverse an existing transaction (section 14) - Owner/Admin */
/*     only, preserves the original untouched.                    */
/* ============================================================ */

create or replace function public.reverse_ledger_transaction(
  p_transaction_id uuid,
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
  v_original record;
  v_entries jsonb;
  v_new_id uuid;
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
    raise exception 'Only Owner/Admin can reverse ledger transactions';
  end if;

  select * into v_original from public.clinic_ledger_transactions t
  where t.id = p_transaction_id and t.clinic_id = v_clinic_id;

  if v_original.id is null then
    raise exception 'Transaction not found for this clinic';
  end if;

  if v_original.reversed_by is not null then
    raise exception 'This transaction has already been reversed';
  end if;

  if v_original.transaction_type = 'Reversal' then
    raise exception 'A reversal transaction cannot itself be reversed';
  end if;

  v_entries := public._build_reversal_entries(p_transaction_id);

  v_new_id := public._post_ledger_transaction(
    v_clinic_id, current_date, 'Reversal', 'reversal', v_original.id,
    'Reversal of: ' || v_original.description
      || case when p_notes is not null and trim(p_notes) <> '' then ' - ' || trim(p_notes) else '' end,
    v_original.currency, v_entries,
    v_original.patient_id, v_original.supplier_id, v_clinic_user_id, v_original.id
  );

  update public.clinic_ledger_transactions set reversed_by = v_new_id where id = v_original.id;

  return v_new_id;
end;
$$;

grant execute on function public.reverse_ledger_transaction(uuid, text) to authenticated;

/* ============================================================ */
/* 15. Opening balances (section 16) - Owner/Admin only, replace  */
/*     semantics (reverses any existing active opening balance    */
/*     for the account before posting the new one).               */
/* ============================================================ */

create or replace function public.set_opening_balance(
  p_account_id uuid,
  p_amount numeric,
  p_as_of date default current_date
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
  v_account record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_existing record;
  v_new_id uuid;
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
    raise exception 'Only Owner/Admin can set opening balances';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Opening balance amount must be zero or greater';
  end if;

  select * into v_account from public.clinic_ledger_accounts a
  where a.id = p_account_id and a.clinic_id = v_clinic_id;

  if v_account.id is null then
    raise exception 'Account not found for this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.opening_balance_equity_account_id is null then
    raise exception 'Opening Balance Equity account is not configured';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  select * into v_existing from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.transaction_type = 'OpeningBalance'
    and t.reference_type = 'opening_balance' and t.reference_id = p_account_id
    and t.reversed_by is null
  order by t.created_at desc
  limit 1;

  if v_existing.id is not null then
    perform public.reverse_ledger_transaction(v_existing.id, 'Superseded by a new opening balance');
  end if;

  if p_amount = 0 then
    return null;
  end if;

  if v_account.type in ('Asset', 'Expense') then
    v_new_id := public._post_ledger_transaction(
      v_clinic_id, p_as_of, 'OpeningBalance', 'opening_balance', p_account_id,
      'Opening balance: ' || v_account.name, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', p_account_id, 'debit', p_amount, 'credit', 0),
        jsonb_build_object('account_id', v_settings.opening_balance_equity_account_id, 'debit', 0, 'credit', p_amount)
      ),
      null, null, v_clinic_user_id, null
    );
  else
    v_new_id := public._post_ledger_transaction(
      v_clinic_id, p_as_of, 'OpeningBalance', 'opening_balance', p_account_id,
      'Opening balance: ' || v_account.name, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.opening_balance_equity_account_id, 'debit', p_amount, 'credit', 0),
        jsonb_build_object('account_id', p_account_id, 'debit', 0, 'credit', p_amount)
      ),
      null, null, v_clinic_user_id, null
    );
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.set_opening_balance(uuid, numeric, date) to authenticated;

/* ============================================================ */
/* 16. Trial balance + General Ledger read functions - plain SQL  */
/*     functions (not plpgsql), so there is no RETURNS TABLE      */
/*     column-name-shadowing risk (the recurring bug class this   */
/*     project has hit before in plpgsql functions), and          */
/*     `security invoker` so they naturally respect the caller's  */
/*     own RLS rather than needing a manual clinic_id check.      */
/* ============================================================ */

create or replace function public.get_trial_balance()
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  total_debit numeric,
  total_credit numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    a.id,
    a.code,
    a.name,
    a.type,
    coalesce(sum(e.debit), 0),
    coalesce(sum(e.credit), 0)
  from public.clinic_ledger_accounts a
  left join public.clinic_ledger_entries e on e.account_id = a.id
  where a.clinic_id in (select cu.clinic_id from public.clinic_users cu where cu.auth_user_id = auth.uid())
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_trial_balance() to authenticated;

create or replace function public.get_account_ledger(
  p_account_id uuid,
  p_start date default null,
  p_end date default null
)
returns table (
  transaction_id uuid,
  transaction_date date,
  description text,
  reference_type text,
  reference_id uuid,
  debit numeric,
  credit numeric,
  running_balance numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  with scoped as (
    select
      t.id as t_transaction_id,
      t.transaction_date as t_transaction_date,
      t.description as t_description,
      t.reference_type as t_reference_type,
      t.reference_id as t_reference_id,
      e.debit as e_debit,
      e.credit as e_credit
    from public.clinic_ledger_entries e
    join public.clinic_ledger_transactions t on t.id = e.transaction_id
    where e.account_id = p_account_id
      and (p_start is null or t.transaction_date >= p_start)
      and (p_end is null or t.transaction_date <= p_end)
  )
  select
    s.t_transaction_id,
    s.t_transaction_date,
    s.t_description,
    s.t_reference_type,
    s.t_reference_id,
    s.e_debit,
    s.e_credit,
    sum(s.e_debit - s.e_credit) over (
      order by s.t_transaction_date, s.t_transaction_id
      rows between unbounded preceding and current row
    )
  from scoped s
  order by s.t_transaction_date, s.t_transaction_id;
$$;

grant execute on function public.get_account_ledger(uuid, date, date) to authenticated;

create or replace function public.get_account_opening_balance(
  p_account_id uuid,
  p_start date
)
returns numeric
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(sum(e.debit - e.credit), 0)
  from public.clinic_ledger_entries e
  join public.clinic_ledger_transactions t on t.id = e.transaction_id
  where e.account_id = p_account_id and t.transaction_date < p_start;
$$;

grant execute on function public.get_account_opening_balance(uuid, date) to authenticated;
