-- Fixes a critical, pre-existing bug discovered while designing Phase 8
-- (CEO Consolidated Financials) of the multi-branch build: three ledger
-- read RPCs - get_trial_balance() (0043), get_profit_and_loss(date,
-- date) (0051), get_balance_sheet(date) (0052) - take no clinic
-- parameter at all and instead scope themselves with
--
--   where a.clinic_id in (
--     select cu.clinic_id from public.clinic_users cu
--     where cu.auth_user_id = auth.uid()
--   )
--
-- This was safe when every person had at most one clinic_users row, but
-- migration 0055_organizations.sql made it normal for a multi-branch
-- organization member (CEO or Member) to hold ONE clinic_users row PER
-- BRANCH they have access to. For such a person, that IN-subquery now
-- resolves to EVERY branch they can access, not just the one branch
-- currently selected in the UI - so today, a CEO's single-branch Ledger
-- -> Trial Balance / Profit & Loss / Balance Sheet page silently shows
-- every branch's accounts merged together, with no branch attribution
-- and no indication anything is merged. Since every branch is seeded
-- with the identical default chart-of-account codes/names (0043's
-- _provision_new_clinic - er, clinic_ledger provisioning - seeds "1000
-- Cash", "4000 Revenue", etc. per clinic), this can even produce
-- duplicate-looking rows with no way to tell them apart.
--
-- Fix: each function gains a new, REQUIRED p_clinic_id parameter and
-- filters by `a.clinic_id = p_clinic_id` instead of the IN-subquery.
-- These functions are `security invoker` (not `security definer`), so
-- RLS on clinic_ledger_accounts still independently governs visibility
-- underneath this filter - passing an explicit p_clinic_id can never be
-- used to see a clinic the caller doesn't already have a real
-- clinic_users row for; it only removes the old, now-unsafe assumption
-- that "the caller's only clinic" is a well-defined thing.
--
-- This changes each function's parameter list (0 args -> 1, 2 args -> 3,
-- 1 arg -> 2), which Postgres treats as a distinct overload rather than
-- something CREATE OR REPLACE can update in place - so the old
-- zero/clinic-less signatures are explicitly dropped first, to avoid
-- leaving the old, still-broken versions callable side by side with the
-- fixed ones. services/ledger.ts (the only caller of any of these three
-- RPCs anywhere in the codebase - confirmed by search) is updated in the
-- same change to pass getCurrentClinicId() explicitly.
--
-- Return shapes are completely unchanged - only the input parameters
-- and the WHERE clause change. Safe to re-run: drop-if-exists + create.

drop function if exists public.get_trial_balance();

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
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_trial_balance(uuid) to authenticated;

drop function if exists public.get_profit_and_loss(date, date);

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
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_profit_and_loss(uuid, date, date) to authenticated;

drop function if exists public.get_balance_sheet(date);

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
    and a.active
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

grant execute on function public.get_balance_sheet(uuid, date) to authenticated;
