-- Fix: ensure_ledger_provisioned() could raise a duplicate-key error on
-- clinic_ledger_accounts_clinic_id_code_key under concurrent calls.
--
-- _ensure_ledger_provisioned_for_clinic() checked "if exists(...) return"
-- before bulk-inserting the default chart of accounts. That check and the
-- insert are not atomic: two concurrent invocations for the same
-- not-yet-provisioned clinic (e.g. getLedgerSettings() and
-- getTrialBalance() firing together via Promise.all in
-- getLedgerDashboardTotals()) can both pass the "not yet provisioned"
-- check before either has committed its insert, so both attempt to
-- insert the same (clinic_id, code) rows.
--
-- Fix: make the accounts insert itself idempotent via
-- "on conflict (clinic_id, code) do nothing", the same pattern already
-- used a few lines below for the clinic_ledger_settings insert. This
-- relies on (does not remove) the existing unique constraint. No table,
-- column, or constraint is changed - only this function's body.
--
-- Does not touch existing accounts or transactions: the on-conflict
-- target is per-account-code, so any account that already exists
-- (including a manually created or previously auto-provisioned one) is
-- left completely untouched, and its id is picked up by the existing
-- "select ... into" lookups exactly as before.

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
    (p_clinic_id, '5900', 'Other Expenses', 'Expense')
  on conflict (clinic_id, code) do nothing;

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
