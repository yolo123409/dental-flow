-- Found live during the Part 2 50-branch scale test: getOrganizationOverview
-- (services/organizations.ts, itself a production-hardening fix earlier in
-- this same pass, replacing an N-branch count-query loop with two batched
-- `.select('clinic_id').in('clinic_id', branchIds)` queries) silently
-- undercounts once an organization's total patient/appointment row count
-- crosses PostgREST's default max-rows limit (1000 on this project).
--
-- Concretely verified: with 50 branches x 40 patients = 2,000 real rows,
-- `select('clinic_id').in(...)` over all of them returned exactly 1,000
-- rows with NO error and a misleadingly-normal-looking response - only a
-- separate `count: 'exact'` request reveals the true total (2,000). The
-- client-side "group rows by clinic_id, count them" logic downstream of
-- that silently truncated result set then produces a WRONG, incomplete
-- patients_total and WRONG per-branch patient counts for whichever
-- branches' rows happen to fall outside Postgres's arbitrary (no ORDER BY)
-- first-1000-rows cut. The appointments-today query wasn't observed to
-- truncate at this dataset's scale (bounded by "today" already), but is
-- the exact same unbounded-row-fetch shape and would hit the identical
-- failure once daily appointment volume across all branches passes 1,000.
--
-- Fix: replace both row-fetching queries with ONE aggregate RPC that
-- returns pre-aggregated per-branch counts (one row per branch - at most
-- a few hundred rows even at very large organization sizes, nowhere near
-- the row cap) instead of one row per patient/appointment. security
-- invoker, so RLS on patients/appointments still independently governs
-- what each caller can actually see - this only changes how the counts
-- are computed, not who can see what.
create or replace function public.get_organization_branch_counts(
  p_clinic_ids uuid[],
  p_today date
)
returns table (
  clinic_id uuid,
  patient_count bigint,
  appointments_today_count bigint
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    c.id as clinic_id,
    (select count(*) from public.patients p where p.clinic_id = c.id) as patient_count,
    (select count(*) from public.appointments a where a.clinic_id = c.id and a.appointment_date = p_today) as appointments_today_count
  from public.clinics c
  where c.id = any(p_clinic_ids);
$$;

grant execute on function public.get_organization_branch_counts(uuid[], date) to authenticated;

-- Same bug class, same root cause, found by checking the two other
-- CEO-Consolidated-Financials queries built the same way earlier in this
-- production-hardening pass: getRevenueTotalsByClinic (services/analytics/
-- revenue.ts) and getPaidExpenseTotalsByClinic (services/expenses.ts) both
-- fetch one row per Paid invoice / Paid expense across every branch and
-- sum client-side - exactly the same shape that just proved truncatable
-- above. At this test's reduced synthetic scale (~50 Paid invoices/branch)
-- the true row count (980) stayed just under the 1,000-row cap, so it did
-- NOT visibly truncate here - but at the ORIGINALLY-REQUESTED full scale
-- (500+ invoices/branch, i.e. multiple thousands of Paid invoices across
-- 50 branches) this would silently under-report consolidated revenue and
-- expenses by however many rows fall past the cap, the same way patient/
-- appointment counts just did. Fixed proactively, before it has a chance
-- to manifest, rather than waiting for a real deployment to hit it.
create or replace function public.get_organization_revenue_by_clinic(
  p_clinic_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (clinic_id uuid, total numeric)
language sql
security invoker
set search_path = public
stable
as $$
  select
    i.clinic_id,
    coalesce(sum(i.total), 0) as total
  from public.clinic_invoices i
  where i.clinic_id = any(p_clinic_ids)
    and i.status = 'Paid'
    and (p_start is null or i.created_at >= p_start)
    and (p_end is null or i.created_at <= p_end)
  group by i.clinic_id;
$$;

grant execute on function public.get_organization_revenue_by_clinic(uuid[], timestamptz, timestamptz) to authenticated;

create or replace function public.get_organization_expenses_by_clinic(
  p_clinic_ids uuid[],
  p_start date,
  p_end date
)
returns table (clinic_id uuid, total numeric)
language sql
security invoker
set search_path = public
stable
as $$
  select
    e.clinic_id,
    coalesce(sum(e.amount), 0) as total
  from public.clinic_expenses e
  where e.clinic_id = any(p_clinic_ids)
    and e.status = 'Paid'
    and (p_start is null or e.expense_date >= p_start)
    and (p_end is null or e.expense_date <= p_end)
  group by e.clinic_id;
$$;

grant execute on function public.get_organization_expenses_by_clinic(uuid[], date, date) to authenticated;
