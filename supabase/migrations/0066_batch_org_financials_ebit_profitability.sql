-- Batches the two remaining per-branch fan-outs in the CEO Consolidated
-- Financials page (services/organizations.ts#getOrganizationFinancials):
-- Treatment Profitability and EBIT/EBITDA. Revenue and Expenses were
-- already reduced to one query each in migration 0065; these two were
-- explicitly disclosed as still O(branches), concurrency-capped at 8
-- rather than fixed, in the original production-hardening report.
--
-- Live-measured before this migration: the EBIT/EBITDA fan-out alone
-- took ~5.4s of a ~10.6s total page load at 50 branches - the dominant
-- remaining cost on that page.
--
-- Same three-function pattern used throughout this file:
--
--   1. ensure_ledger_provisioned_multi - the batched form of the existing
--      ensure_ledger_provisioned(p_clinic_id) (0059). Same authorization
--      guarantee (only provisions a clinic the caller genuinely holds a
--      clinic_users row for), just looped server-side across an array
--      instead of the client making one round trip per branch.
--
--   2. get_profit_and_loss_multi - the batched form of the existing
--      get_profit_and_loss(p_clinic_id, p_start, p_end) (0058). Identical
--      select/join/group-by logic, with clinic_id added to both the
--      filter (`= any(...)` instead of `=`) and the grouping. Every row's
--      join is already naturally scoped to its own account's clinic_id
--      (clinic_ledger_accounts.id is globally unique), so this produces
--      byte-identical rows to calling the single-clinic version once per
--      branch and concatenating the results - not an approximation.
--      security invoker, same as the original: RLS on
--      clinic_ledger_entries/transactions/accounts still independently
--      governs visibility beneath this explicit filter.
--
--   3. get_treatment_actuals_multi - NOT simply a batched version of the
--      existing per-clinic query (that query fetches one row per Paid
--      invoice with nested line items, which is exactly the row-fetch-
--      and-sum-in-JS shape the row-cap audit flagged elsewhere - see
--      migration 0065's own comment). Aggregates performed-count and
--      revenue per (clinic, normalized treatment name) directly in SQL
--      instead, returning at most one row per distinct treatment name
--      actually billed per clinic - bounded by catalog size, never by
--      invoice volume, so it can't hit the row cap regardless of how
--      many invoices a branch has. services/treatmentProfitability.ts's
--      single-clinic getTreatmentProfitabilityReportForPeriod is updated
--      in the same change to call this too (with a one-element array),
--      fixing the same latent truncation risk there rather than
--      batching it while just accepting the flaw stays live is a
--      single-branch view. SUM in SQL over the same rows equals SUM in
--      JS over the same rows for numeric columns - the actual/revenue
--      figures this replaces are identical in value, only the query
--      shape changes.
--
-- All three are additive, non-destructive, and safe to re-run.

create or replace function public.ensure_ledger_provisioned_multi(p_clinic_ids uuid[])
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

  foreach v_clinic_id in array p_clinic_ids loop
    if exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id
    ) then
      perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
    end if;
  end loop;
end;
$$;

grant execute on function public.ensure_ledger_provisioned_multi(uuid[]) to authenticated;

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
    and a.active
  group by a.clinic_id, a.id, a.code, a.name, a.type
  order by a.clinic_id, a.code;
$$;

grant execute on function public.get_profit_and_loss_multi(uuid[], date, date) to authenticated;

create or replace function public.get_treatment_actuals_multi(
  p_clinic_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  clinic_id uuid,
  treatment_name_normalized text,
  performed_count numeric,
  revenue numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    i.clinic_id,
    lower(trim(ii.treatment_name)) as treatment_name_normalized,
    coalesce(sum(ii.quantity), 0) as performed_count,
    coalesce(sum(ii.total_price), 0) as revenue
  from public.clinic_invoices i
  join public.clinic_invoice_items ii on ii.invoice_id = i.id
  where i.clinic_id = any(p_clinic_ids)
    and i.status = 'Paid'
    and (p_start is null or i.created_at >= p_start)
    and (p_end is null or i.created_at <= p_end)
    and trim(coalesce(ii.treatment_name, '')) <> ''
  group by i.clinic_id, lower(trim(ii.treatment_name));
$$;

grant execute on function public.get_treatment_actuals_multi(uuid[], timestamptz, timestamptz) to authenticated;
