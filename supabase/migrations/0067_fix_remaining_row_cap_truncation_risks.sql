-- Exhaustive repository-wide follow-up to migrations 0065/0066, which
-- fixed the PostgREST silent-1,000-row-truncation bug in 3 (then 3 more)
-- specific places but explicitly did not claim to be exhaustive. This
-- migration covers the single genuinely new SQL-aggregate RPC identified
-- by that exhaustive pass; every other finding was fixed in the same
-- pass by paging safely through the existing query via lib/fetchAllRows.ts
-- instead (no new database object needed - see the Production Readiness
-- 2.0 report for the full file-by-file list).
--
-- get_revenue_analytics is the single-clinic sibling of
-- get_organization_revenue_by_clinic (0065): getRevenueAnalyticsForPeriod
-- (services/analytics/revenue.ts), called on every Dashboard/Analytics
-- page load, was still fetching every Paid invoice's (total, tax) and
-- every non-Paid invoice's (total, amount_paid) as individual rows and
-- summing them in JS - the exact same truncatable shape already fixed
-- for the org-wide aggregate, just never carried over to the single-
-- clinic version it was copied from. The three invoice-count fields
-- (paid/unpaid/total) already used `count: 'exact', head: true` requests,
-- which are NOT affected by this bug (PostgREST computes the count
-- server-side independent of how many data rows it returns) and are
-- left unchanged.
create or replace function public.get_revenue_analytics(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  total_revenue numeric,
  total_tax numeric,
  outstanding_amount numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    coalesce(sum(total) filter (where status = 'Paid'), 0) as total_revenue,
    coalesce(sum(tax) filter (where status = 'Paid'), 0) as total_tax,
    coalesce(sum(total) filter (where status <> 'Paid'), 0)
      - coalesce(sum(amount_paid) filter (where status <> 'Paid'), 0) as outstanding_amount
  from public.clinic_invoices
  where clinic_id = p_clinic_id
    and (p_start is null or created_at >= p_start)
    and (p_end is null or created_at <= p_end);
$$;

grant execute on function public.get_revenue_analytics(uuid, timestamptz, timestamptz) to authenticated;

-- services/billing.ts#getInvoiceBalanceTotals (used by PatientStats on
-- every Patients page load - the clinic-wide outstanding-balance
-- figure) had the exact same unbounded `.select('total, amount_paid')`
-- + client-side sum shape, found directly while implementing real
-- pagination for getPatients/getInvoices in this same pass - it isn't
-- one of the 5 reports/patients/etc. call sites from the exhaustive
-- audit, but the identical bug class, so fixed the same way.
create or replace function public.get_invoice_balance_totals(p_clinic_id uuid)
returns table (total numeric, paid numeric)
language sql
security invoker
set search_path = public
stable
as $$
  select
    coalesce(sum(total), 0) as total,
    coalesce(sum(amount_paid), 0) as paid
  from public.clinic_invoices
  where clinic_id = p_clinic_id;
$$;

grant execute on function public.get_invoice_balance_totals(uuid) to authenticated;
