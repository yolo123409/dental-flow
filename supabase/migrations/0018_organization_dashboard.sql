-- ============================================================
-- Phase 6: Organization Executive Dashboard
--
-- Aggregates data across every branch (clinic) an organization member is
-- authorized to see. This is the first place in the codebase that reads
-- across more than one clinic_id at once. Every existing clinic-scoped RLS
-- policy (appointments/patients/clinic_invoices/...) only ever checks
-- clinic_users membership, and switch_active_branch (0017) deliberately
-- never gives a Viewer a clinic_users row - so a Viewer has zero RLS path
-- to read any clinic data directly. These RPCs are security definer and
-- do their own authorization (mirroring switch_active_branch's pattern),
-- so no existing RLS policy needs to change.
-- ============================================================

-- ============================================================
-- 1. Composite indexes for cross-branch aggregate queries.
--    idx_patients_clinic_id (existing, migration 0005) is sufficient for
--    the all-time/unfiltered patient count below - no new patients index
--    needed.
-- ============================================================

create index if not exists idx_clinic_invoices_clinic_id_status_created_at
  on public.clinic_invoices(clinic_id, status, created_at);

create index if not exists idx_appointments_clinic_id_date
  on public.appointments(clinic_id, appointment_date);

-- ============================================================
-- 2. get_organization_branch_ids - shared helper resolving which clinic
--    ids a caller may see within one organization. Deliberately scopes
--    the organization_users lookup by organization_id explicitly (unlike
--    switch_active_branch's "user_id + status" lookup) because a caller
--    can hold membership rows in more than one organization
--    (unique(organization_id, user_id) allows exactly that) - an
--    unscoped lookup could grab the wrong org's row and compute the
--    wrong branch_access/branch set entirely.
-- ============================================================

create or replace function public.get_organization_branch_ids(p_organization_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_org_user record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_org_user
  from public.organization_users
  where user_id = v_uid
    and organization_id = p_organization_id
    and status = 'Active';

  if v_org_user.id is null then
    raise exception 'You do not have access to this organization';
  end if;

  if v_org_user.branch_access = 'all' then
    return query
      select c.id from public.clinics c
      where c.organization_id = p_organization_id;
  else
    return query
      select oub.clinic_id from public.organization_user_branches oub
      where oub.organization_user_id = v_org_user.id;
  end if;
end;
$$;

grant execute on function public.get_organization_branch_ids(uuid)
  to authenticated;

-- ============================================================
-- 3. get_organization_branch_performance - one row per branch with
--    revenue/outstanding/patient/appointment/invoice totals for the
--    caller's authorized branches. The branch_ids CTE re-asserts
--    clinics.organization_id = p_organization_id AND intersects with
--    get_organization_branch_ids as defense in depth - nothing in the
--    schema constrains organization_user_branches.clinic_id to belong to
--    the same org as the organization_user's org (switch_active_branch
--    itself does this same redundant re-check, for the same reason).
--    clinic_invoices/appointments/patients are pre-aggregated in their
--    own CTEs before being left-joined onto clinics - joining the three
--    tables directly would fan-out (cross-product) before aggregation
--    and wildly inflate every sum/count.
--
--    Date bounds use "(p_start is null or ... >= p_start) and (p_end is
--    null or ... <= p_end)" rather than BETWEEN, since getDateRange()'s
--    "All Time" returns null/null and BETWEEN with a NULL operand
--    evaluates to NULL (i.e. excludes every row), not "unbounded". The
--    inclusive <= matches services/analytics/revenue.ts's existing
--    .gte(...).lte(...) convention exactly, so a branch's numbers agree
--    whether viewed from its own single-clinic Analytics page or from
--    here. patient_count is intentionally all-time/unfiltered, matching
--    getDashboardStats()'s existing convention.
-- ============================================================

create or replace function public.get_organization_branch_performance(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  clinic_id uuid,
  clinic_name text,
  revenue numeric,
  outstanding_balance numeric,
  patient_count bigint,
  appointment_count bigint,
  invoice_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with branch_ids as (
    select id from public.clinics
    where organization_id = p_organization_id
      and id in (select * from public.get_organization_branch_ids(p_organization_id))
  ),
  inv as (
    select
      ci.clinic_id,
      sum(ci.total) filter (where ci.status = 'Paid') as revenue,
      coalesce(sum(ci.total) filter (where ci.status <> 'Paid'), 0)
        - coalesce(sum(ci.amount_paid) filter (where ci.status <> 'Paid'), 0) as outstanding_balance,
      count(*) as invoice_count
    from public.clinic_invoices ci
    where ci.clinic_id in (select id from branch_ids)
      and (p_start is null or ci.created_at >= p_start)
      and (p_end is null or ci.created_at <= p_end)
    group by ci.clinic_id
  ),
  appt as (
    select a.clinic_id, count(*) as appointment_count
    from public.appointments a
    where a.clinic_id in (select id from branch_ids)
      and (p_start is null or a.appointment_date >= p_start)
      and (p_end is null or a.appointment_date <= p_end)
    group by a.clinic_id
  ),
  pat as (
    select p.clinic_id, count(*) as patient_count
    from public.patients p
    where p.clinic_id in (select id from branch_ids)
    group by p.clinic_id
  )
  select
    c.id,
    c.name,
    coalesce(inv.revenue, 0),
    coalesce(inv.outstanding_balance, 0),
    coalesce(pat.patient_count, 0),
    coalesce(appt.appointment_count, 0),
    coalesce(inv.invoice_count, 0)
  from public.clinics c
  left join inv on inv.clinic_id = c.id
  left join appt on appt.clinic_id = c.id
  left join pat on pat.clinic_id = c.id
  where c.id in (select id from branch_ids)
  order by c.name;
end;
$$;

grant execute on function public.get_organization_branch_performance(uuid, timestamptz, timestamptz)
  to authenticated;

-- ============================================================
-- 4. get_organization_revenue_trend - org-wide revenue bucketed over
--    time, for the caller's authorized branches. Bucketing is done in
--    SQL (date_trunc + group by) rather than fetched raw and bucketed
--    client-side like the single-clinic getRevenueChartData - org-wide
--    across 100+ branches can mean far more raw invoice rows than one
--    clinic's chart ever fetches, and "no client-side full-table
--    aggregation" is an explicit requirement for this feature.
--    p_granularity is passed as a normal bound function argument to
--    date_trunc (not string-interpolated into dynamic SQL), so it is not
--    injection-prone regardless - the allowlist check below exists only
--    to produce a clean application-level error instead of a raw
--    Postgres "timestamp unit not recognized" error.
-- ============================================================

create or replace function public.get_organization_revenue_trend(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_granularity text
)
returns table (
  bucket timestamptz,
  revenue numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_granularity not in ('hour', 'day', 'month') then
    raise exception 'Invalid granularity: %', p_granularity;
  end if;

  return query
  with branch_ids as (
    select id from public.clinics
    where organization_id = p_organization_id
      and id in (select * from public.get_organization_branch_ids(p_organization_id))
  )
  select
    date_trunc(p_granularity, ci.created_at) as bucket,
    sum(ci.total) as revenue
  from public.clinic_invoices ci
  where ci.clinic_id in (select id from branch_ids)
    and ci.status = 'Paid'
    and (p_start is null or ci.created_at >= p_start)
    and (p_end is null or ci.created_at <= p_end)
  group by 1
  order by 1;
end;
$$;

grant execute on function public.get_organization_revenue_trend(uuid, timestamptz, timestamptz, text)
  to authenticated;
