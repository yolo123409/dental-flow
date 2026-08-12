-- Phase 6: full Organization Overview executive dashboard. Ten
-- SECURITY DEFINER RPCs (one extended, nine new), every one following the
-- exact pattern already audited and shipped in 0018/0030:
--   - authorize via get_organization_branch_ids(p_organization_id)
--   - re-intersect with clinics.organization_id = p_organization_id as
--     defense in depth (organization_user_branches.clinic_id has no DB
--     constraint tying it to the granting org - see 0029's comment)
--   - never rely on RLS for the underlying tables, since clinic_expenses/
--     clinic_inventory_items/clinic_purchase_orders/
--     clinic_goods_received_notes/dentists RLS only grants access via a
--     clinic_users row, which an org-wide CEO/Manager may not have per
--     branch (confirmed in the Phase 6 architecture audit).
--
-- Every list RPC uses order by ... limit N in SQL - nothing here fetches
-- a full table for client-side summing/ranking.
--
-- Safe to re-run: drop-then-create for functions whose return column
-- list changes, create or replace otherwise, matching this folder's
-- conventions throughout.

-- ============================================================
-- 1. get_organization_branch_performance - add dentist_count and
--    new_patient_count. dentist_count is a live snapshot (not
--    date-ranged, same convention as inventory_value/break_even_target);
--    new_patient_count IS date-ranged (created_at within p_start/p_end),
--    reusing services/patients.ts#getNewPatientsThisMonthCount's own
--    created_at-based definition of "new" - not the separate,
--    non-date-ranged last_visit-based definition in
--    services/analytics/patients.ts, which doesn't fit a period widget.
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
  inventory_value numeric,
  dentist_count bigint,
  new_patient_count bigint
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
  new_pat as (
    select p.clinic_id, count(*) as new_patient_count
    from public.patients p
    where p.clinic_id in (select id from branch_ids)
      and (p_start is null or p.created_at >= p_start)
      and (p_end is null or p.created_at <= p_end)
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
  ),
  dent as (
    select d.clinic_id, count(*) as dentist_count
    from public.dentists d
    where d.clinic_id in (select id from branch_ids)
      and d.active = true
    group by d.clinic_id
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
    coalesce(inv_value.inventory_value, 0),
    coalesce(dent.dentist_count, 0),
    coalesce(new_pat.new_patient_count, 0)
  from public.clinics c
  left join inv on inv.clinic_id = c.id
  left join appt on appt.clinic_id = c.id
  left join pat on pat.clinic_id = c.id
  left join new_pat on new_pat.clinic_id = c.id
  left join exp on exp.clinic_id = c.id
  left join inv_value on inv_value.clinic_id = c.id
  left join dent on dent.clinic_id = c.id
  left join public.clinic_settings cs on cs.clinic_id = c.id
  where c.id in (select id from branch_ids)
  order by c.name;
end;
$$;

grant execute on function public.get_organization_branch_performance(uuid, timestamptz, timestamptz)
  to authenticated;

-- ============================================================
-- 2. get_organization_expense_trend - identical shape to
--    get_organization_revenue_trend (0018), bucketed against
--    clinic_expenses instead of clinic_invoices. Net Position trend is
--    computed client-side from this plus the revenue trend - not a new
--    query, same formula NetPositionWidget already uses.
-- ============================================================

create or replace function public.get_organization_expense_trend(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_granularity text
)
returns table (
  bucket timestamptz,
  total numeric
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
    date_trunc(p_granularity, e.expense_date::timestamptz) as bucket,
    sum(e.amount) as total
  from public.clinic_expenses e
  where e.clinic_id in (select id from branch_ids)
    and e.status = 'Paid'
    and (p_start is null or e.expense_date >= p_start::date)
    and (p_end is null or e.expense_date <= p_end::date)
  group by 1
  order by 1;
end;
$$;

grant execute on function public.get_organization_expense_trend(uuid, timestamptz, timestamptz, text)
  to authenticated;

-- ============================================================
-- 3. get_organization_appointment_breakdown - mirrors
--    services/appointments.ts#getAppointmentStats()'s plain status-count
--    definitions (the only tracked, auditable appointment-status logic
--    in this repo - two other RPCs referenced from the frontend have no
--    SQL definition anywhere in this migrations folder and were
--    deliberately NOT used as a reference). today_count has no status
--    filter, matching getTodaysAppointments()'s own convention.
-- ============================================================

create or replace function public.get_organization_appointment_breakdown(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  clinic_id uuid,
  clinic_name text,
  today_count bigint,
  upcoming_count bigint,
  completed_count bigint,
  cancelled_count bigint
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
  appt as (
    select
      a.clinic_id,
      count(*) filter (where a.appointment_date = current_date) as today_count,
      count(*) filter (where a.status = 'Scheduled') as upcoming_count,
      count(*) filter (where a.status = 'Completed') as completed_count,
      count(*) filter (where a.status = 'Cancelled') as cancelled_count
    from public.appointments a
    where a.clinic_id in (select id from branch_ids)
      and (p_start is null or a.appointment_date >= p_start)
      and (p_end is null or a.appointment_date <= p_end)
    group by a.clinic_id
  )
  select
    c.id,
    c.name,
    coalesce(appt.today_count, 0),
    coalesce(appt.upcoming_count, 0),
    coalesce(appt.completed_count, 0),
    coalesce(appt.cancelled_count, 0)
  from public.clinics c
  left join appt on appt.clinic_id = c.id
  where c.id in (select id from branch_ids)
  order by c.name;
end;
$$;

grant execute on function public.get_organization_appointment_breakdown(uuid, timestamptz, timestamptz)
  to authenticated;

-- ============================================================
-- 4. get_organization_low_stock_items - mirrors
--    services/inventory.ts#getStockStatus()'s quantity <= minimum_stock_level
--    predicate (covers both "Low Stock" and "Out of Stock").
-- ============================================================

create or replace function public.get_organization_low_stock_items(
  p_organization_id uuid,
  p_limit int
)
returns table (
  clinic_id uuid,
  clinic_name text,
  item_id uuid,
  item_name text,
  quantity numeric,
  minimum_stock_level numeric
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
    ii.clinic_id, c.name, ii.id, ii.name, ii.quantity, ii.minimum_stock_level
  from public.clinic_inventory_items ii
  join public.clinics c on c.id = ii.clinic_id
  where ii.clinic_id in (select id from branch_ids)
    and ii.quantity <= ii.minimum_stock_level
  order by (ii.minimum_stock_level - ii.quantity) desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_low_stock_items(uuid, int)
  to authenticated;

-- ============================================================
-- 5. get_organization_highest_value_inventory - server-side ranking by
--    quantity * cost_per_unit, the same formula already used by
--    get_organization_branch_performance's inventory_value column and
--    the inventory list page's own client-side "Value" column/sort.
-- ============================================================

create or replace function public.get_organization_highest_value_inventory(
  p_organization_id uuid,
  p_limit int
)
returns table (
  clinic_id uuid,
  clinic_name text,
  item_id uuid,
  item_name text,
  quantity numeric,
  cost_per_unit numeric,
  value numeric
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
    ii.clinic_id, c.name, ii.id, ii.name, ii.quantity, ii.cost_per_unit,
    ii.quantity * ii.cost_per_unit as value
  from public.clinic_inventory_items ii
  join public.clinics c on c.id = ii.clinic_id
  where ii.clinic_id in (select id from branch_ids)
  order by (ii.quantity * ii.cost_per_unit) desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_highest_value_inventory(uuid, int)
  to authenticated;

-- ============================================================
-- 6. get_organization_recent_grn_receipts - clinic_inventory_movements
--    rows written by confirm_grn_receipt (reason = 'Restock', grn_id set),
--    exactly what services/inventory.ts#getRecentMovements() already
--    reads for the single-branch case. Doubles as "Recently Received
--    Stock" (Inventory widget) and "Recent Deliveries" (Procurement
--    widget) - one RPC, not built twice.
-- ============================================================

create or replace function public.get_organization_recent_grn_receipts(
  p_organization_id uuid,
  p_limit int
)
returns table (
  movement_id uuid,
  clinic_id uuid,
  clinic_name text,
  item_name text,
  quantity_change numeric,
  supplier_name text,
  grn_number text,
  created_at timestamptz
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
    m.id, m.clinic_id, c.name, ii.name, m.quantity_change,
    s.name, g.grn_number, m.created_at
  from public.clinic_inventory_movements m
  join public.clinics c on c.id = m.clinic_id
  join public.clinic_inventory_items ii on ii.id = m.inventory_item_id
  left join public.clinic_goods_received_notes g on g.id = m.grn_id
  left join public.clinic_suppliers s on s.id = g.supplier_id
  where m.clinic_id in (select id from branch_ids)
    and m.reason = 'Restock'
    and m.grn_id is not null
  order by m.created_at desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_recent_grn_receipts(uuid, int)
  to authenticated;

-- ============================================================
-- 7. get_organization_recent_purchase_orders - mirrors
--    services/purchaseOrders.ts#getPurchaseOrders()'s
--    order("created_at", { ascending: false }) convention.
-- ============================================================

create or replace function public.get_organization_recent_purchase_orders(
  p_organization_id uuid,
  p_limit int
)
returns table (
  po_id uuid,
  po_number text,
  clinic_id uuid,
  clinic_name text,
  supplier_name text,
  status text,
  total numeric,
  created_at timestamptz
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
    po.id, po.po_number, po.clinic_id, c.name, s.name, po.status, po.total, po.created_at
  from public.clinic_purchase_orders po
  join public.clinics c on c.id = po.clinic_id
  left join public.clinic_suppliers s on s.id = po.supplier_id
  where po.clinic_id in (select id from branch_ids)
  order by po.created_at desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_recent_purchase_orders(uuid, int)
  to authenticated;

-- ============================================================
-- 8. get_organization_supplier_spend - "Top Suppliers". Spend is
--    computed from clinic_grn_items.unit_cost * quantity_received on
--    Received GRNs, NOT purchase order totals - a PO can be partially
--    fulfilled, and confirm_grn_receipt already treats a GRN's unit_cost
--    as the real, received cost (it's what gets written onto
--    clinic_inventory_items.cost_per_unit), never the PO's unit_price.
-- ============================================================

create or replace function public.get_organization_supplier_spend(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_limit int
)
returns table (
  supplier_id uuid,
  supplier_name text,
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
    s.id, s.name, sum(gi.unit_cost * gi.quantity_received) as total
  from public.clinic_grn_items gi
  join public.clinic_goods_received_notes g on g.id = gi.grn_id
  join public.clinic_suppliers s on s.id = g.supplier_id
  where g.clinic_id in (select id from branch_ids)
    and g.status = 'Received'
    and (p_start is null or g.date_received >= p_start::date)
    and (p_end is null or g.date_received <= p_end::date)
  group by s.id, s.name
  order by total desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_supplier_spend(uuid, timestamptz, timestamptz, int)
  to authenticated;

-- ============================================================
-- 9. get_organization_recent_activity - one UNION ALL round trip across
--    six tables instead of six separate queries, ordered overall by
--    occurred_at desc, limited once at the end. source_type lets the UI
--    render the right icon/link per row.
-- ============================================================

create or replace function public.get_organization_recent_activity(
  p_organization_id uuid,
  p_limit int
)
returns table (
  source_type text,
  source_id uuid,
  clinic_id uuid,
  clinic_name text,
  label text,
  occurred_at timestamptz
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
  activity as (
    select 'patient' as source_type, p.id as source_id, p.clinic_id,
      (p.first_name || ' ' || p.last_name) as label, p.created_at as occurred_at
    from public.patients p
    where p.clinic_id in (select id from branch_ids)

    union all

    -- appointments has no confirmed created_at column anywhere in this
    -- repo's tracked history (unlike every other table here, it predates
    -- the migrations folder and its full column list was never
    -- committed) - appointment_date is used instead, which IS confirmed
    -- (used throughout services/appointments.ts and the existing
    -- get_organization_branch_performance appt CTE).
    select 'appointment', a.id, a.clinic_id,
      coalesce(p.first_name || ' ' || p.last_name, 'Appointment'),
      a.appointment_date::timestamptz
    from public.appointments a
    left join public.patients p on p.id = a.patient_id
    where a.clinic_id in (select id from branch_ids)

    union all

    select 'invoice', i.id, i.clinic_id, i.invoice_number, i.created_at
    from public.clinic_invoices i
    where i.clinic_id in (select id from branch_ids)

    union all

    select 'grn', g.id, g.clinic_id, g.grn_number, g.created_at
    from public.clinic_goods_received_notes g
    where g.clinic_id in (select id from branch_ids)

    union all

    select 'purchase_order', po.id, po.clinic_id, po.po_number, po.created_at
    from public.clinic_purchase_orders po
    where po.clinic_id in (select id from branch_ids)

    union all

    select 'expense', e.id, e.clinic_id, e.description, e.created_at
    from public.clinic_expenses e
    where e.clinic_id in (select id from branch_ids)
  )
  select
    activity.source_type, activity.source_id, activity.clinic_id, c.name,
    activity.label, activity.occurred_at
  from activity
  join public.clinics c on c.id = activity.clinic_id
  order by activity.occurred_at desc
  limit p_limit;
end;
$$;

grant execute on function public.get_organization_recent_activity(uuid, int)
  to authenticated;

-- ============================================================
-- 10. search_organization_patients - cross-branch patient search,
--     limited to authorized branches.
-- ============================================================

create or replace function public.search_organization_patients(
  p_organization_id uuid,
  p_query text,
  p_limit int
)
returns table (
  patient_id uuid,
  clinic_id uuid,
  clinic_name text,
  first_name text,
  last_name text,
  phone text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_term text := '%' || trim(p_query) || '%';
begin
  if trim(coalesce(p_query, '')) = '' then
    return;
  end if;

  return query
  with branch_ids as (
    select id from public.clinics
    where organization_id = p_organization_id
      and id in (select * from public.get_organization_branch_ids(p_organization_id))
  )
  select
    p.id, p.clinic_id, c.name, p.first_name, p.last_name, p.phone
  from public.patients p
  join public.clinics c on c.id = p.clinic_id
  where p.clinic_id in (select id from branch_ids)
    and (
      p.first_name ilike v_term
      or p.last_name ilike v_term
      or p.phone ilike v_term
    )
  order by p.first_name, p.last_name
  limit p_limit;
end;
$$;

grant execute on function public.search_organization_patients(uuid, text, int)
  to authenticated;
