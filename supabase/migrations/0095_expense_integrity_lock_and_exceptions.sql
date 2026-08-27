-- FIN-3.6: close the "editing posted expenses without reversal" gap
-- deferred from FIN-3.5, and add the expense-side reconciliation
-- primitive that already exists for invoices/payments (migrations
-- 0085/0086), so FIN-3.9's Financial Health Center can reuse it rather
-- than a new one being invented later.
--
-- EXPENSE LIFECYCLE (confirmed by reading every write path before writing
-- this migration, not assumed): clinic_expenses.status is a CHECK
-- constraint of exactly ('Paid', 'Voided') - there is no "Pending"/accrued
-- concept anywhere in this schema. createExpense() always inserts status
-- 'Paid', which the AFTER INSERT trigger (migration 0043) immediately
-- posts as Debit [category's expense account] / Credit [payment method's
-- cash account] - genuinely cash-basis by construction, not an
-- assumption this migration is introducing. voidExpense() is the only
-- other lifecycle transition (Paid -> Voided), already correctly
-- reversed by _trigger_reverse_voided_expense_ledger (migration 0043) -
-- untouched here.
--
-- THE GAP: updateExpense() (services/expenses.ts, live in the Money Out
-- UI's Edit flow) can change category_id, amount, expense_date,
-- payment_method, and supplier_id on ANY 'Paid' expense - including one
-- that already has a posted ledger transaction. None of those edits
-- reach the ledger: the original Debit/Credit posting (for the OLD
-- amount, OLD category's account, OLD payment method's account, OLD
-- date) stays exactly as it was, now silently describing a transaction
-- that no longer matches its own source record. This is exactly the
-- "editing posted expenses without reversal" risk this phase's brief
-- names, and the direct sibling of the clinic_invoices gap FIN-3.5 just
-- closed the same way.
--
-- THE FIX: a BEFORE UPDATE trigger blocks a change to any of the five
-- fields that actually feed a posted ledger transaction (amount,
-- category_id, payment_method, expense_date, supplier_id) once the
-- expense already has an 'expense'-type ledger posting. Deliberately
-- narrower than the clinic_invoices fix's whitelist approach: unlike
-- invoices (which have no general "edit" feature at all), updateExpense()
-- is a real, currently-used feature for fixing description/payee/
-- reference/notes/receipt_path after the fact - none of those feed any
-- ledger figure or account mapping, so they stay freely editable always.
-- Blacklisting only the five ledger-feeding fields closes the real defect
-- without breaking that existing, legitimate workflow.
--
-- voidExpense() only ever touches status/voided_at/voided_by/void_reason/
-- updated_at - none of which are blacklisted - so voiding a posted
-- expense continues to work exactly as before. The existing RLS policy
-- (clinic_expenses_update_own_clinic) already requires status = 'Paid'
-- to update at all, so a Voided expense can never reach this trigger via
-- updateExpense() in the first place - unchanged, not touched here.

create or replace function public._trigger_guard_posted_expense_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.clinic_ledger_transactions t
    where t.reference_type = 'expense' and t.reference_id = OLD.id
  ) then
    if NEW.amount is distinct from OLD.amount
      or NEW.category_id is distinct from OLD.category_id
      or NEW.payment_method is distinct from OLD.payment_method
      or NEW.expense_date is distinct from OLD.expense_date
      or NEW.supplier_id is distinct from OLD.supplier_id
      or NEW.clinic_id is distinct from OLD.clinic_id
    then
      raise exception 'This expense has already been posted to the ledger - amount, category, payment method, date, and supplier cannot change after posting. Void and re-enter it instead.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_posted_expense_update on public.clinic_expenses;
create trigger trg_guard_posted_expense_update
  before update on public.clinic_expenses
  for each row execute function public._trigger_guard_posted_expense_update();

/* ============================================================ */
/* Expense-side sibling of get_payment_ledger_exceptions          */
/* (migration 0086) - same shape, for FIN-3.9's reuse.             */
/* ============================================================ */

create or replace function public.get_expense_ledger_exceptions(p_clinic_id uuid)
returns table (
  expense_id uuid,
  description text,
  expense_amount numeric,
  status text,
  posting_count bigint,
  posted_debit numeric,
  exception_type text
)
language sql
security invoker
set search_path = public
stable
as $$
  with expense_postings as (
    select
      e.id as expense_id,
      e.description,
      e.amount as expense_amount,
      e.status,
      count(distinct t.id) as posting_count,
      coalesce(sum(en.debit), 0) as posted_debit
    from public.clinic_expenses e
    left join public.clinic_ledger_transactions t
      on t.clinic_id = e.clinic_id
     and t.reference_type = 'expense'
     and t.reference_id = e.id
    left join public.clinic_ledger_entries en
      on en.transaction_id = t.id
     and en.debit > 0
    where e.clinic_id = p_clinic_id
      and e.status = 'Paid'
    group by e.id, e.description, e.amount, e.status
  )
  select
    ep.expense_id,
    ep.description,
    ep.expense_amount,
    ep.status,
    ep.posting_count,
    ep.posted_debit,
    case
      when ep.posting_count = 0 then 'missing'
      when ep.posting_count > 1 then 'duplicate'
      else 'mismatched'
    end as exception_type
  from expense_postings ep
  where ep.posting_count = 0
     or ep.posting_count > 1
     or abs(ep.posted_debit - ep.expense_amount) > 0.01;
$$;

grant execute on function public.get_expense_ledger_exceptions(uuid) to authenticated;
