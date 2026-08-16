-- Balance Sheet: every account's cumulative debit/credit balance as of
-- an arbitrary date, in one set-based query.
--
-- get_trial_balance() (0043) is deliberately "as of now" only, and must
-- stay that way for the existing Trial Balance page. get_profit_and_loss()
-- (0051) is deliberately bounded on both ends (a period, not a running
-- balance) and returns Income/Expense accounts only. Neither can answer
-- "what was every account's balance as of an arbitrary past/future date",
-- which a Balance Sheet needs for Assets/Liabilities/Equity - and, since
-- there is no dedicated Retained Earnings account, also for Income/
-- Expense accounts (summed client-side into cumulative Retained
-- Earnings as of that date). So this adds one more sibling read function
-- rather than changing the other two.
--
-- Same conventions as get_trial_balance/get_profit_and_loss: plain sql,
-- `security invoker` (RLS via clinic_users), `stable`, read-only. Single
-- query covering every account in one pass - no per-account looping, no
-- N+1.
--
-- No tables, columns, or constraints are touched - this is a new
-- function only.

create or replace function public.get_balance_sheet(p_as_of date)
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
      and t.transaction_date <= p_as_of
  ) on e.account_id = a.id
  where a.clinic_id in (select cu.clinic_id from public.clinic_users cu where cu.auth_user_id = auth.uid())
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_balance_sheet(date) to authenticated;
