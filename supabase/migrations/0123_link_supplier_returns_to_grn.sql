-- Full-app audit fix H14 (High): returnToSupplier() (services/
-- inventory.ts) has no link back to the GRN a returned item was received
-- through, so get_supplier_outstanding_grns()/get_supplier_ap_summary()
-- (migration 0044) never subtract a return's value - the AP figure staff
-- pay against overstates what's actually owed after any return, and the
-- app's own reconciliation-mismatch banner (getSupplierApReconciliation)
-- has no remediation for this specific cause (its "Repair Ledger
-- Postings" button only backfills missing GRN postings, not this).
--
-- THE FIX: adjust_inventory_stock() gains an optional p_grn_id - when a
-- "Returned to Supplier" movement is tied to the GRN it came from, that
-- GRN's outstanding total nets out the return's value, exactly like a
-- payment already does. Adding a parameter changes this function's
-- signature, so the old 10-arg version must be explicitly dropped first
-- (create or replace only replaces an identical signature) - the
-- Postgres function-identity gotcha this project's own migrations have
-- hit before.
--
-- Safe to re-run: drop function if exists, create or replace throughout.

drop function if exists public.adjust_inventory_stock(
  uuid, numeric, text, text, text, date, uuid, uuid, uuid, text
);

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_delta numeric,
  p_reason text,
  p_notes text default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_supplier_id uuid default null,
  p_patient_id uuid default null,
  p_treatment_id uuid default null,
  p_reference text default null,
  p_grn_id uuid default null
)
returns clinic_inventory_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_before numeric;
  v_after numeric;
  v_cost_per_unit numeric;
  v_item public.clinic_inventory_items;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_delta = 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.clinic_inventory_items ii on ii.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and ii.id = p_item_id;

  if v_clinic_id is null then
    raise exception 'Material not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to adjust stock';
  end if;

  if p_reason not in (
    'Restock', 'Used', 'Damaged', 'Expired',
    'Correction', 'Initial Stock', 'Returned to Supplier', 'Other'
  ) then
    raise exception 'Invalid movement reason';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.clinic_suppliers s
    where s.id = p_supplier_id and s.clinic_id = v_clinic_id
  ) then
    raise exception 'Supplier not found for this clinic';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.clinic_id = v_clinic_id
  ) then
    raise exception 'Patient not found for this clinic';
  end if;

  if p_treatment_id is not null and not exists (
    select 1 from public.clinic_treatments t
    where t.id = p_treatment_id and t.clinic_id = v_clinic_id
  ) then
    raise exception 'Treatment not found for this clinic';
  end if;

  -- Full-app audit fix H14: p_grn_id must belong to this clinic (and, if
  -- a supplier was also given, to that same supplier - a return can't
  -- plausibly be "from" a GRN belonging to a different supplier).
  if p_grn_id is not null and not exists (
    select 1 from public.clinic_goods_received_notes g
    where g.id = p_grn_id
      and g.clinic_id = v_clinic_id
      and (p_supplier_id is null or g.supplier_id = p_supplier_id)
  ) then
    raise exception 'Delivery not found for this clinic/supplier';
  end if;

  select quantity, cost_per_unit into v_before, v_cost_per_unit
  from public.clinic_inventory_items
  where id = p_item_id and clinic_id = v_clinic_id
  for update;

  v_after := v_before + p_delta;

  if v_after < 0 then
    raise exception 'Cannot remove more than the current stock (% available).', v_before;
  end if;

  update public.clinic_inventory_items
  set quantity = v_after, updated_at = now()
  where id = p_item_id and clinic_id = v_clinic_id
  returning * into v_item;

  insert into public.clinic_inventory_movements (
    clinic_id, inventory_item_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, notes, created_by,
    batch_number, expiry_date, supplier_id, patient_id, treatment_id, reference,
    unit_cost, grn_id
  )
  values (
    v_clinic_id, p_item_id, case when p_delta > 0 then 'Increase' else 'Decrease' end, p_delta,
    v_before, v_after, p_reason, nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    nullif(trim(coalesce(p_batch_number, '')), ''), p_expiry_date, p_supplier_id, p_patient_id, p_treatment_id,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_cost_per_unit, p_grn_id
  );

  return v_item;
end;
$function$;

grant execute on function public.adjust_inventory_stock(
  uuid, numeric, text, text, text, date, uuid, uuid, uuid, text, uuid
) to authenticated;

-- Full-app audit fix H14: net out returned value against the GRN it was
-- returned from - the "Returned to Supplier" reason movement is always a
-- Decrease (negative quantity_change), so abs() gives back the positive
-- quantity actually returned.

create or replace function public.get_supplier_outstanding_grns(p_supplier_id uuid)
returns table (
  grn_id uuid,
  grn_number text,
  date_received date,
  total_amount numeric,
  paid_amount numeric,
  outstanding_amount numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    g.id,
    g.grn_number,
    g.date_received,
    coalesce(item_totals.total, 0) - coalesce(returns.total, 0),
    coalesce(paid.total, 0),
    coalesce(item_totals.total, 0) - coalesce(returns.total, 0) - coalesce(paid.total, 0)
  from public.clinic_goods_received_notes g
  left join (
    select gi.grn_id, sum(gi.quantity_received * gi.unit_cost) as total
    from public.clinic_grn_items gi
    group by gi.grn_id
  ) item_totals on item_totals.grn_id = g.id
  left join (
    select m.grn_id, sum(abs(m.quantity_change) * coalesce(m.unit_cost, 0)) as total
    from public.clinic_inventory_movements m
    where m.reason = 'Returned to Supplier' and m.grn_id is not null
    group by m.grn_id
  ) returns on returns.grn_id = g.id
  left join (
    select a.grn_id, sum(a.amount) as total
    from public.clinic_supplier_payment_allocations a
    join public.clinic_supplier_payments p on p.id = a.supplier_payment_id
    where p.status = 'Posted'
    group by a.grn_id
  ) paid on paid.grn_id = g.id
  where g.supplier_id = p_supplier_id and g.status = 'Received'
  order by g.date_received;
$$;

create or replace function public.get_supplier_ap_summary()
returns table (
  supplier_id uuid,
  supplier_name text,
  total_purchases numeric,
  total_paid numeric,
  outstanding numeric,
  last_payment_date date
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    s.id,
    s.name,
    coalesce(purchases.total, 0) - coalesce(returns.total, 0),
    coalesce(payments.total, 0),
    coalesce(purchases.total, 0) - coalesce(returns.total, 0) - coalesce(payments.total, 0),
    payments.last_date
  from public.clinic_suppliers s
  left join (
    select g.supplier_id, sum(gi.quantity_received * gi.unit_cost) as total
    from public.clinic_goods_received_notes g
    join public.clinic_grn_items gi on gi.grn_id = g.id
    where g.status = 'Received'
    group by g.supplier_id
  ) purchases on purchases.supplier_id = s.id
  left join (
    select g.supplier_id, sum(abs(m.quantity_change) * coalesce(m.unit_cost, 0)) as total
    from public.clinic_inventory_movements m
    join public.clinic_goods_received_notes g on g.id = m.grn_id
    where m.reason = 'Returned to Supplier' and m.grn_id is not null
    group by g.supplier_id
  ) returns on returns.supplier_id = s.id
  left join (
    select p.supplier_id, sum(p.amount) as total, max(p.payment_date) as last_date
    from public.clinic_supplier_payments p
    where p.status = 'Posted'
    group by p.supplier_id
  ) payments on payments.supplier_id = s.id
  where purchases.total is not null or payments.total is not null
  order by s.name;
$$;
