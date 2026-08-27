-- FIN-3.1: stop invoice tax from being booked straight into Treatment
-- Revenue - post it to a dedicated VAT Payable liability instead.
--
-- SCOPE (decided explicitly, not guessed): this migration fixes ONLY the
-- output-VAT booking defect using the tax amount ALREADY computed and
-- stored on clinic_invoices (subtotal/tax/total, set once at createInvoice()
-- time - see services/billing.ts#calculateInvoiceTotals()). It does NOT:
--   - add any per-line/per-treatment taxable-vs-exempt classification
--     (clinic_invoice_items and the treatment catalog have no such column
--     today, and no clinic has ever needed mixed taxable/exempt content on
--     one invoice - tax is, and remains, a single clinic-wide on/off/rate
--     setting snapshotted per invoice);
--   - add any input-VAT / purchase-side tax tracking (clinic_expenses and
--     the GRN tables have no tax column at all - out of scope for this
--     migration, would belong to the expense/GRN phases);
--   - touch any already-posted historical ledger entry. The posting
--     trigger only ever fires on INSERT, so the ~39 already-posted
--     "DentalFlow Demo Clinic" invoices (~KES 354k of tax already folded
--     into Treatment Revenue) are physically untouched by this migration
--     and are left as a documented, dated legacy exception - never
--     retroactively reclassified or rewritten (explicit user decision).
--
-- Going forward: an invoice with NEW.tax > 0 now posts three lines instead
-- of two - Debit AR (full total), Credit Treatment Revenue (total - tax),
-- Credit VAT Payable (tax) - which keeps the transaction balanced by
-- construction (revenue + vat = total, exactly what AR is debited for).
-- An invoice with NEW.tax = 0 (the other 5 clinics today, tax disabled)
-- posts exactly as before: unchanged 2-line Debit AR / Credit Revenue.
--
-- Safe to re-run: add column if not exists, create-or-replace functions,
-- idempotent backfill (insert ... where not exists / update ... where
-- null), matching every other migration in this folder.

/* ============================================================ */
/* 1. New liability account + settings mapping column           */
/* ============================================================ */

alter table public.clinic_ledger_settings
  add column if not exists vat_payable_account_id uuid
    references public.clinic_ledger_accounts(id) on delete set null;

/* ============================================================ */
/* 2. Provisioning (new clinics): seed the VAT Payable account   */
/*    and wire it into clinic_ledger_settings from the start.    */
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
  v_vat_payable uuid;
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
  select a.id into v_obe from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '3100';
  select a.id into v_revenue from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '4000';
  select a.id into v_other_expense from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5900';
  select a.id into v_supplies_used from public.clinic_ledger_accounts a where a.clinic_id = p_clinic_id and a.code = '5200';

  insert into public.clinic_ledger_settings (
    clinic_id, treatment_revenue_account_id, accounts_receivable_account_id,
    inventory_account_id, accounts_payable_account_id, supplies_used_account_id,
    default_expense_account_id, default_cash_account_id, opening_balance_equity_account_id,
    vat_payable_account_id, payment_method_accounts
  )
  values (
    p_clinic_id, v_revenue, v_ar, v_inventory, v_ap, v_supplies_used,
    v_other_expense, v_cash, v_obe,
    v_vat_payable,
    jsonb_build_object('Cash', v_cash, 'Bank Transfer', v_bank, 'M-Pesa', v_mpesa)
  )
  on conflict (clinic_id) do nothing;
end;
$$;

/* ============================================================ */
/* 3. Backfill (existing clinics): add the account + mapping to  */
/*    every clinic already provisioned before this migration.    */
/* ============================================================ */

insert into public.clinic_ledger_accounts (clinic_id, code, name, type)
select s.clinic_id, '2100', 'VAT Payable', 'Liability'
from public.clinic_ledger_settings s
where not exists (
  select 1 from public.clinic_ledger_accounts a
  where a.clinic_id = s.clinic_id and a.code = '2100'
);

update public.clinic_ledger_settings s
set vat_payable_account_id = a.id
from public.clinic_ledger_accounts a
where a.clinic_id = s.clinic_id
  and a.code = '2100'
  and s.vat_payable_account_id is null;

/* ============================================================ */
/* 4. Invoice posting trigger: split tax into VAT Payable         */
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
  v_tax numeric;
  v_revenue_amount numeric;
  v_entries jsonb;
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

    v_tax := coalesce(NEW.tax, 0);

    if v_tax > 0 and v_settings.vat_payable_account_id is not null then
      v_revenue_amount := NEW.total - v_tax;

      v_entries := jsonb_build_array(
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', NEW.total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.treatment_revenue_account_id, 'debit', 0, 'credit', v_revenue_amount),
        jsonb_build_object('account_id', v_settings.vat_payable_account_id, 'debit', 0, 'credit', v_tax)
      );
    else
      if v_tax > 0 then
        insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
        values (NEW.clinic_id, 'invoice', NEW.id, 'VAT Payable account is not configured; tax amount was posted to Treatment Revenue instead.');
      end if;

      v_entries := jsonb_build_array(
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', NEW.total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.treatment_revenue_account_id, 'debit', 0, 'credit', NEW.total)
      );
    end if;

    perform public._post_ledger_transaction(
      NEW.clinic_id, NEW.created_at::date, 'Invoice', 'invoice', NEW.id,
      'Invoice ' || NEW.invoice_number, coalesce(v_currency, 'KES'),
      v_entries,
      NEW.patient_id, null, null, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'invoice', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;
