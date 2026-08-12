-- Organization Overview dashboard extension: adds Money Out, Break-even
-- target, and Inventory value to the existing per-branch aggregation RPC,
-- plus a new org-wide expense category breakdown RPC. Both follow the
-- exact same pattern as the existing get_organization_branch_performance /
-- get_organization_revenue_trend (migration 0018): SECURITY DEFINER,
-- authorize via get_organization_branch_ids() (not RLS - clinic_expenses/
-- clinic_inventory_items/clinic_settings RLS only grants access via a
-- clinic_users row, which a CEO/Viewer with pure organization-level access
-- may not have for every branch), and re-intersect with
-- clinics.organization_id = p_organization_id as defense in depth.
--
-- Safe to re-run: drop-then-create throughout (create or replace cannot
-- change a function's `returns table` column list, so the extended
-- function must be dropped first), matching this folder's conventions.

-- ============================================================
-- 1. get_organization_branch_performance - now also returns money_out,
--    break_even_target, and inventory_value per branch.
--
--    money_out is date-ranged identically to revenue (same inclusive
--    p_start/p_end bounds, cast to date since clinic_expenses.expense_date
--    is a date column, matching services/expenses.ts's own
--    .gte(...)/.lte(...) convention on that column).
--
--    break_even_target and inventory_value are both point-in-time
--    snapshots, not period aggregates - break_even_target is a fixed
--    monthly configuration value (clinic_settings.monthly_break_even_revenue)
--    and inventory_value is current stock valuation - neither is filtered
--    by p_start/p_end, exactly like this function's existing patient_count
--    column (already documented as "intentionally all-time/unfiltered").
--
--    break_even_target is left nullable (no coalesce) - NULL means "not
--    configured for this branch," which must never be treated as 0,
--    same rule as the single-branch Financial Targets feature.
-- ============================================================

drop function if exists public.get_organization_branch_performance(uuid, timestamptz, timestamptz);

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
  invoice_count bigint,
  money_out numeric,
  break_even_target numeric,
  inventory_value numeric
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
  ),
  exp as (
    select e.clinic_id, sum(e.amount) as money_out
    from public.clinic_expenses e
    where e.clinic_id in (select id from branch_ids)
      and e.status = 'Paid'
      and (p_start is null or e.expense_date >= p_start::date)
      and (p_end is null or e.expense_date <= p_end::date)
    group by e.clinic_id
  ),
  inv_value as (
    select ii.clinic_id, sum(ii.quantity * ii.cost_per_unit) as inventory_value
    from public.clinic_inventory_items ii
    where ii.clinic_id in (select id from branch_ids)
    group by ii.clinic_id
  )
  select
    c.id,
    c.name,
    coalesce(inv.revenue, 0),
    coalesce(inv.outstanding_balance, 0),
    coalesce(pat.patient_count, 0),
    coalesce(appt.appointment_count, 0),
    coalesce(inv.invoice_count, 0),
    coalesce(exp.money_out, 0),
    cs.monthly_break_even_revenue,
    coalesce(inv_value.inventory_value, 0)
  from public.clinics c
  left join inv on inv.clinic_id = c.id
  left join appt on appt.clinic_id = c.id
  left join pat on pat.clinic_id = c.id
  left join exp on exp.clinic_id = c.id
  left join inv_value on inv_value.clinic_id = c.id
  left join public.clinic_settings cs on cs.clinic_id = c.id
  where c.id in (select id from branch_ids)
  order by c.name;
end;
$$;

grant execute on function public.get_organization_branch_performance(uuid, timestamptz, timestamptz)
  to authenticated;

-- ============================================================
-- 2. get_organization_expense_breakdown - one row per expense category,
--    summed across every branch the caller is authorized to see, for the
--    "Largest Expense Category" org-wide widget. "Highest Spending
--    Branch" needs no separate query - it's max(money_out) over the
--    branch performance rows above, computed client-side.
-- ============================================================

create or replace function public.get_organization_expense_breakdown(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  category_name text,
  total numeric
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
  )
  select
    coalesce(cat.name, 'Uncategorized') as category_name,
    sum(e.amount) as total
  from public.clinic_expenses e
  left join public.clinic_expense_categories cat on cat.id = e.category_id
  where e.clinic_id in (select id from branch_ids)
    and e.status = 'Paid'
    and (p_start is null or e.expense_date >= p_start::date)
    and (p_end is null or e.expense_date <= p_end::date)
  group by coalesce(cat.name, 'Uncategorized')
  order by total desc;
end;
$$;

grant execute on function public.get_organization_expense_breakdown(uuid, timestamptz, timestamptz)
  to authenticated;
