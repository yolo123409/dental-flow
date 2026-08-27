-- FIN-4.4: minimal Customer Credit / overpayment foundation, per explicit
-- user decision (not guessed):
--   - Scope: backend foundation only, no UI this pass.
--   - Default policy: an overpayment becomes a Customer Credit by
--     default (kept on file against the patient's next visit); staff can
--     record a real-world refund against it at any time.
--   - The two historical overpaid invoices (INV-00007/INV-00010) are
--     resolved by a SEPARATE migration (0101) using this foundation.
--
-- AUDIT BEFORE DESIGNING (see FIN-4.4's report for the full audit):
-- recordPayment() already rejects any payment exceeding an invoice's
-- outstanding balance (added after INV-00007/INV-00010 were created,
-- which is why nothing newer joined them) - so this closes a real gap in
-- what happens when a legitimate overpayment DOES occur (a discount
-- applied after payment, a corrected total, etc.), not a currently-open
-- hole in ordinary payment recording. There has never been a credit or
-- refund concept anywhere in this schema (migration 0043's own comment:
-- "No refund concept exists anywhere") - AR reporting already
-- defensively floors each invoice's contribution at zero specifically
-- because of that (getOutstandingInvoiceBalance), so this migration does
-- not need to touch AR reporting at all, only add the missing piece.
--
-- ARCHITECTURE: reuses the existing double-entry ledger engine exactly
-- as-is - one new Liability account (Customer Credits, matching how VAT
-- Payable was added in 0090), one new table as the patient-facing record
-- of what's owed (clinic_customer_credits - the ledger transactions
-- themselves remain the audit trail, this table is the current-balance
-- view), and three new SECURITY DEFINER RPCs. None of these RPCs reuse
-- recordPayment()/_trigger_post_payment_ledger() - deliberately separate,
-- the same precedent migration 0088's own header comment already
-- established for add_treatment_material vs adjust_inventory_stock:
-- repurposing an existing, already-shipped function's meaning is riskier
-- than a small amount of duplicated arithmetic in a clearly-scoped new
-- one. clinic_invoices.balance/amount_paid/status are the historical
-- record of what was actually paid and are never touched by grant -
-- only apply_customer_credit changes them, because THAT operation is a
-- real reduction of a DIFFERENT invoice's balance.

/* ============================================================ */
/* 1. Widen the ledger's own transaction_type vocabulary          */
/* ============================================================ */

alter table public.clinic_ledger_transactions
  drop constraint clinic_ledger_transactions_transaction_type_check;

alter table public.clinic_ledger_transactions
  add constraint clinic_ledger_transactions_transaction_type_check
  check (transaction_type in (
    'Invoice', 'Payment', 'Expense', 'InventoryReceipt', 'InventoryConsumption',
    'InventoryReturn', 'ManualJournal', 'Reversal', 'OpeningBalance',
    'CustomerCreditGrant', 'CustomerCreditApplication', 'CustomerCreditRefund'
  ));

/* ============================================================ */
/* 2. New liability account + settings mapping column             */
/* ============================================================ */

alter table public.clinic_ledger_settings
  add column if not exists customer_credit_account_id uuid
    references public.clinic_ledger_accounts(id) on delete set null;

create or replace function public._ensure_ledger_provisioned_for_clinic(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash uuid; v_bank uuid; v_mpesa uuid; v_ar uuid; v_inventory uuid;
  v_ap uuid; v_obe uuid; v_revenue uuid; v_other_expense uuid; v_supplies_used uuid;
  v_vat_payable uuid; v_customer_credits uuid;
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
    (p_clinic_id, '2100', 'VAT Payable', 'Liability'),
    (p_clinic_id, '2200', 'Customer Credits', 'Liability'),
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
  select a.id into v_vat_payable from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '2100';
  select a.id into v_customer_credits from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '2200';
  select a.id into v_obe from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '3100';
  select a.id into v_revenue from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '4000';
  select a.id into v_other_expense from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5900';
  select a.id into v_supplies_used from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5200';

  insert into public.clinic_ledger_settings (
    clinic_id, treatment_revenue_account_id, accounts_receivable_account_id,
    inventory_account_id, accounts_payable_account_id, supplies_used_account_id,
    default_expense_account_id, default_cash_account_id, opening_balance_equity_account_id,
    vat_payable_account_id, customer_credit_account_id, payment_method_accounts
  )
  values (
    p_clinic_id, v_revenue, v_ar, v_inventory, v_ap, v_supplies_used,
    v_other_expense, v_cash, v_obe,
    v_vat_payable, v_customer_credits,
    jsonb_build_object('Cash', v_cash, 'Bank Transfer', v_bank, 'M-Pesa', v_mpesa)
  )
  on conflict (clinic_id) do nothing;
end;
$$;

-- Backfill for every clinic already provisioned before this migration.
insert into public.clinic_ledger_accounts (clinic_id, code, name, type)
select s.clinic_id, '2200', 'Customer Credits', 'Liability'
from public.clinic_ledger_settings s
where not exists (
  select 1 from public.clinic_ledger_accounts a
  where a.clinic_id = s.clinic_id and a.code = '2200'
);

update public.clinic_ledger_settings s
set customer_credit_account_id = a.id
from public.clinic_ledger_accounts a
where a.clinic_id = s.clinic_id
  and a.code = '2200'
  and s.customer_credit_account_id is null;

/* ============================================================ */
/* 3. clinic_customer_credits - the patient-facing record of what */
/*    is owed. The ledger transactions remain the audit trail;    */
/*    this table is the current-balance view, one row per grant.  */
/* ============================================================ */

create table if not exists public.clinic_customer_credits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_invoice_id uuid not null references public.clinic_invoices(id),
  amount numeric not null check (amount > 0),
  remaining_amount numeric not null check (remaining_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.clinic_users(id),
  updated_at timestamptz not null default now(),
  constraint clinic_customer_credits_remaining_not_over check (remaining_amount <= amount)
);

create index if not exists idx_clinic_customer_credits_clinic_patient
  on public.clinic_customer_credits (clinic_id, patient_id);

alter table public.clinic_customer_credits enable row level security;

-- Read-only from RLS's perspective: every write happens through the
-- SECURITY DEFINER RPCs below, exactly like clinic_ledger_transactions/
-- clinic_ledger_entries themselves have no direct INSERT/UPDATE policy.
drop policy if exists "clinic_customer_credits_select_own_clinic" on public.clinic_customer_credits;
create policy "clinic_customer_credits_select_own_clinic"
  on public.clinic_customer_credits for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid() and cu.clinic_id = clinic_customer_credits.clinic_id
    )
  );

-- Defense in depth matching FIN-3.8: a direct table write (bypassing
-- both RLS's absence of an insert policy AND the RPCs below) is blocked
-- at the trigger level too, for the same financial-table role set
-- (Owner/Admin/Receptionist) every other money-handling table uses.
drop trigger if exists trg_guard_role_customer_credits on public.clinic_customer_credits;
create trigger trg_guard_role_customer_credits
  before insert or update or delete on public.clinic_customer_credits
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

grant select on public.clinic_customer_credits to authenticated;

/* ============================================================ */
/* 4. grant_customer_credit - reclassify an overpayment            */
/* ============================================================ */

-- Only for invoices whose payment IS already correctly posted to the
-- ledger (the ordinary, going-forward case) - reclassifies the excess
-- from AR into the Customer Credits liability with one new entry. Never
-- touches the original Invoice/Payment postings or clinic_invoices'
-- own amount_paid/balance/status (those remain the accurate historical
-- record of what was actually paid).
create or replace function public.grant_customer_credit(
  p_invoice_id uuid,
  p_amount numeric default null,
  p_notes text default null
)
returns public.clinic_customer_credits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.clinic_invoices;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_overpayment numeric;
  v_amount numeric;
  v_credit public.clinic_customer_credits;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invoice from public.clinic_invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_invoice.clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to grant a customer credit.', coalesce(v_role, 'none');
  end if;

  -- grant_customer_credit deliberately never touches clinic_invoices'
  -- own amount_paid/balance/status (see this migration's header) - so
  -- without this check, calling it twice on the same invoice would
  -- still see the same negative balance and silently grant a second,
  -- duplicate credit for money that was only ever received once.
  if exists (select 1 from public.clinic_customer_credits where source_invoice_id = p_invoice_id) then
    raise exception 'A customer credit has already been granted for invoice %.', v_invoice.invoice_number;
  end if;

  v_overpayment := round(-1 * v_invoice.balance, 2);
  if v_overpayment <= 0 then
    raise exception 'Invoice % is not overpaid (balance %).', v_invoice.invoice_number, v_invoice.balance;
  end if;

  v_amount := coalesce(p_amount, v_overpayment);
  if v_amount <= 0 or v_amount > v_overpayment then
    raise exception 'Amount must be between 0 and the overpayment of % (got %).', v_overpayment, v_amount;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_invoice.clinic_id;
  if v_settings.accounts_receivable_account_id is null or v_settings.customer_credit_account_id is null then
    raise exception 'Accounts Receivable or Customer Credits account is not configured for this clinic.';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_invoice.clinic_id;

  insert into public.clinic_customer_credits (
    clinic_id, patient_id, source_invoice_id, amount, remaining_amount, notes, created_by
  ) values (
    v_invoice.clinic_id, v_invoice.patient_id, v_invoice.id, v_amount, v_amount, p_notes, v_clinic_user_id
  )
  returning * into v_credit;

  perform public._post_ledger_transaction(
    v_invoice.clinic_id, current_date, 'CustomerCreditGrant', 'customer_credit', v_credit.id,
    'Customer credit granted for overpayment on ' || v_invoice.invoice_number,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', 0, 'credit', v_amount)
    ),
    v_invoice.patient_id, null, v_clinic_user_id, null
  );

  return v_credit;
end;
$$;

grant execute on function public.grant_customer_credit(uuid, numeric, text) to authenticated;

/* ============================================================ */
/* 5. apply_customer_credit - use an existing credit against a    */
/*    different, currently-outstanding invoice for the SAME       */
/*    patient.                                                    */
/* ============================================================ */

create or replace function public.apply_customer_credit(
  p_credit_id uuid,
  p_invoice_id uuid,
  p_amount numeric
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_credit public.clinic_customer_credits;
  v_invoice public.clinic_invoices;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_new_amount_paid numeric;
  v_new_balance numeric;
  v_new_status text;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than 0.';
  end if;

  select * into v_credit from public.clinic_customer_credits where id = p_credit_id;
  if not found then
    raise exception 'Customer credit not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to apply a customer credit.', coalesce(v_role, 'none');
  end if;

  select * into v_invoice from public.clinic_invoices where id = p_invoice_id and clinic_id = v_credit.clinic_id;
  if not found then
    raise exception 'Invoice not found in this clinic';
  end if;

  if v_invoice.patient_id != v_credit.patient_id then
    raise exception 'This credit belongs to a different patient than the target invoice.';
  end if;

  if p_amount > v_credit.remaining_amount then
    raise exception 'Amount (%) exceeds the credit''s remaining balance (%).', p_amount, v_credit.remaining_amount;
  end if;

  if p_amount > v_invoice.balance then
    raise exception 'Amount (%) exceeds invoice %''s outstanding balance (%).', p_amount, v_invoice.invoice_number, v_invoice.balance;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_credit.clinic_id;
  if v_settings.accounts_receivable_account_id is null or v_settings.customer_credit_account_id is null then
    raise exception 'Accounts Receivable or Customer Credits account is not configured for this clinic.';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_credit.clinic_id;

  update public.clinic_customer_credits
  set remaining_amount = remaining_amount - p_amount, updated_at = now()
  where id = v_credit.id;

  -- Mirrors recordPayment()'s own status derivation exactly (Paid when
  -- balance <= 0, Partially Paid when something has been paid, else
  -- Unpaid) - never a competing definition of what these statuses mean.
  v_new_amount_paid := round(v_invoice.amount_paid + p_amount, 2);
  v_new_balance := round(v_invoice.total - v_new_amount_paid, 2);
  v_new_status := case
    when v_new_balance <= 0 then 'Paid'
    when v_new_amount_paid > 0 then 'Partially Paid'
    else 'Unpaid'
  end;

  update public.clinic_invoices
  set amount_paid = v_new_amount_paid, balance = v_new_balance, status = v_new_status
  where id = v_invoice.id
  returning * into v_invoice;

  perform public._post_ledger_transaction(
    v_credit.clinic_id, current_date, 'CustomerCreditApplication', 'customer_credit', v_credit.id,
    'Customer credit applied to ' || v_invoice.invoice_number,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', 0, 'credit', p_amount)
    ),
    v_invoice.patient_id, null, v_clinic_user_id, null
  );

  return v_invoice;
end;
$$;

grant execute on function public.apply_customer_credit(uuid, uuid, numeric) to authenticated;

/* ============================================================ */
/* 6. refund_customer_credit - RECORD a refund that has already   */
/*    happened outside the system (cash handed back, a real       */
/*    M-Pesa reversal, etc.) - never moves money itself, the       */
/*    same pattern clinic_expenses/clinic_payments already use     */
/*    to record money that already moved.                         */
/* ============================================================ */

create or replace function public.refund_customer_credit(
  p_credit_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns public.clinic_customer_credits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_credit public.clinic_customer_credits;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_cash_account_id uuid;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than 0.';
  end if;

  select * into v_credit from public.clinic_customer_credits where id = p_credit_id;
  if not found then
    raise exception 'Customer credit not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to refund a customer credit.', coalesce(v_role, 'none');
  end if;

  if p_amount > v_credit.remaining_amount then
    raise exception 'Amount (%) exceeds the credit''s remaining balance (%).', p_amount, v_credit.remaining_amount;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_credit.clinic_id;
  if v_settings.customer_credit_account_id is null then
    raise exception 'Customer Credits account is not configured for this clinic.';
  end if;

  v_cash_account_id := coalesce(
    (v_settings.payment_method_accounts ->> p_payment_method)::uuid,
    v_settings.default_cash_account_id
  );
  if v_cash_account_id is null then
    raise exception 'No cash/bank account is configured for payment method %.', p_payment_method;
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_credit.clinic_id;

  update public.clinic_customer_credits
  set remaining_amount = remaining_amount - p_amount, updated_at = now()
  where id = v_credit.id
  returning * into v_credit;

  perform public._post_ledger_transaction(
    v_credit.clinic_id, current_date, 'CustomerCreditRefund', 'customer_credit', v_credit.id,
    'Customer credit refunded via ' || p_payment_method ||
      case when p_reference is not null then ' (' || p_reference || ')' else '' end ||
      case when p_notes is not null then ' - ' || p_notes else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_cash_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, null, v_clinic_user_id, null
  );

  return v_credit;
end;
$$;

grant execute on function public.refund_customer_credit(uuid, numeric, text, text, text) to authenticated;
