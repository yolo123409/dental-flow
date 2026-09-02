-- Full-app audit fix C3 (Critical): get_trial_balance, get_profit_and_loss
-- (+ _multi), and get_balance_sheet all filter `and a.active` - so
-- deactivating any chart-of-accounts account (a single click, no
-- confirmation, no check for existing entries - app/admin/settings/
-- accounting/page.tsx) silently and RETROACTIVELY drops that account's
-- entire debit/credit history from every past report. Trial Balance and
-- Balance Sheet happen to self-flag the resulting imbalance (their
-- `balanced`/`difference` fields go non-zero), but P&L has no such check
-- at all - it just silently understates revenue or expenses forever, for
-- periods that already closed, with zero indication anything changed.
--
-- THE FIX: `active` should govern whether an account can be selected for
-- NEW entries - it must never govern whether HISTORICAL activity appears
-- in a report. Removing `and a.active` from these four aggregations is
-- the complete, correct, minimal fix - every account that ever had
-- activity in the requested period shows up regardless of its current
-- active flag, exactly matching how real double-entry accounting treats
-- a retired account (you don't erase Marketing's history because you
-- stopped using that account going forward).
--
-- get_account_ledger (0043) already never filters on `active` at all -
-- it doesn't even join clinic_ledger_accounts - so it needs no change.
--
-- Every function below is `create or replace` over its exact current
-- live signature (confirmed against migrations 0058/0066) - no drop, no
-- grant change needed.

create or replace function public.get_trial_balance(p_clinic_id uuid)
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
  where a.clinic_id = p_clinic_id
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

create or replace function public.get_profit_and_loss(p_clinic_id uuid, p_start date, p_end date)
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
  where a.clinic_id = p_clinic_id
    and a.type in ('Income', 'Expense')
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

create or replace function public.get_balance_sheet(p_clinic_id uuid, p_as_of date)
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
  where a.clinic_id = p_clinic_id
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

create or replace function public.get_profit_and_loss_multi(
  p_clinic_ids uuid[],
  p_start date,
  p_end date
)
returns table (
  clinic_id uuid,
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
    a.clinic_id,
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
  where a.clinic_id = any(p_clinic_ids)
    and a.type in ('Income', 'Expense')
  group by a.clinic_id, a.id, a.code, a.name, a.type
  order by a.clinic_id, a.code;
$$;
