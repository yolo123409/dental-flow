-- Profit & Loss: period-scoped Income/Expense account movements.
--
-- get_trial_balance() (0043) is intentionally all-time/cumulative - it's
-- a balance-sheet-style snapshot ("as of now") and must stay that way for
-- the existing Trial Balance page. A Profit & Loss report needs the same
-- per-account debit/credit shape but scoped to a date range instead, so
-- this adds a new, separate read function rather than changing
-- get_trial_balance's behavior.
--
-- Same conventions as get_trial_balance/get_account_ledger: plain sql
-- (no plpgsql column-shadowing risk), `security invoker` so it naturally
-- respects the caller's own RLS via clinic_users, `stable`, read-only.
-- Restricted to Income/Expense accounts only - the two account types a
-- P&L is built from; Asset/Liability/Equity accounts are out of scope
-- here (that's what Trial Balance is for).
--
-- No tables, columns, or constraints are touched - this is a new
-- function only.

create or replace function public.get_profit_and_loss(p_start date, p_end date)
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
  left join (
    public.clinic_ledger_entries e
    join public.clinic_ledger_transactions t
      on t.id = e.transaction_id
      and t.transaction_date >= p_start
      and t.transaction_date <= p_end
  ) on e.account_id = a.id
  where a.clinic_id in (select cu.clinic_id from public.clinic_users cu where cu.auth_user_id = auth.uid())
    and a.type in ('Income', 'Expense')
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_profit_and_loss(date, date) to authenticated;
