-- Billing audit fix #3: a treatment is billed in one shot - there is no
-- deposit or payment-plan concept anywhere. Root canals, implants, and
-- orthodontics routinely need a deposit before starting or a two-part
-- payment (deposit + balance). This models that as a clean two-charge
-- split, reusing the existing charge -> create_invoice_from_charges ->
-- ledger pipeline completely unchanged - not a second billing engine.
--
-- uq_clinic_charges_treatment_plan_item_id (0089) enforced exactly one
-- charge per treatment_plan_item. Its actual job - stop
-- sync_treatment_charge_amount() from ever double-creating a charge for
-- a normal item - is already independently guaranteed by that function's
-- own `if v_item.charge_id is not null` check, untouched below. Deposit
-- charges are only ever created through add_treatment_deposit(), never
-- through sync_treatment_charge_amount(), so the two paths can't
-- collide - the index can be dropped outright.
--
-- sync_treatment_charge_amount() DOES need one change: today it
-- resyncs the "one" charge's amount to the item's full
-- estimated_price*quantity on every edit (price change, tooth count
-- change). Left unchanged, that would silently wipe out a deposit split
-- the next time the treatment is edited, by resetting the balance
-- charge back to the full price. It now subtracts the deposit amount
-- (floored at 0) when a deposit exists - the deposit charge itself is
-- never touched by this function, on purpose: a deposit is an already-
-- agreed (possibly already paid) fixed figure that shouldn't move just
-- because the treatment's price was edited later.
--
-- Safe to re-run: drop index if exists, add column if not exists,
-- create or replace function.

/* ============================================================ */
/* 1. Drop the now-superseded one-charge-per-item constraint       */
/* ============================================================ */

drop index if exists public.uq_clinic_charges_treatment_plan_item_id;

/* ============================================================ */
/* 2. deposit_charge_id - the item's existing charge_id becomes    */
/*    "the balance" once a deposit exists; charge_id alone         */
/*    (deposit_charge_id null) means "not on a payment plan",      */
/*    unchanged from today.                                        */
/* ============================================================ */

alter table public.treatment_plan_items
  add column if not exists deposit_charge_id uuid references public.clinic_charges(id) on delete set null;

/* ============================================================ */
/* 3. sync_treatment_charge_amount - deposit-aware balance sync    */
/*    (exact copy of 0080's function, with only the 'Pending'      */
/*    branch's amount computation changed).                        */
/* ============================================================ */

create or replace function public.sync_treatment_charge_amount(
  p_treatment_plan_item_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.treatment_plan_items;
  v_charge_status text;
  v_patient_id uuid;
  v_new_charge_id uuid;
  v_deposit_amount numeric;
  v_target_amount numeric;
begin
  select * into v_item
  from public.treatment_plan_items
  where id = p_treatment_plan_item_id;

  if v_item.id is null then
    return;
  end if;

  if v_item.charge_id is null then
    -- Became billable after creation (e.g. price was 0, now positive via
    -- an edit) - stage a new Pending charge now, the same shape
    -- create_treatment_with_teeth already uses at creation time.
    if v_item.estimated_price > 0 then
      select patient_id into v_patient_id
      from public.treatment_plans
      where id = v_item.treatment_plan_id;

      insert into public.clinic_charges (
        clinic_id, patient_id, tooth_number, treatment_name, amount, status, treatment_plan_item_id
      )
      values (
        v_item.clinic_id, v_patient_id, v_item.tooth_number, v_item.procedure,
        v_item.estimated_price * v_item.quantity, 'Pending', v_item.id
      )
      returning id into v_new_charge_id;

      update public.treatment_plan_items
      set charge_id = v_new_charge_id
      where id = v_item.id;
    end if;

    return;
  end if;

  select status into v_charge_status
  from public.clinic_charges
  where id = v_item.charge_id;

  if v_charge_status = 'Pending' then
    v_target_amount := v_item.estimated_price * v_item.quantity;

    if v_item.deposit_charge_id is not null then
      select amount into v_deposit_amount
      from public.clinic_charges
      where id = v_item.deposit_charge_id;

      v_target_amount := greatest(0, v_target_amount - coalesce(v_deposit_amount, 0));
    end if;

    update public.clinic_charges
    set
      amount = v_target_amount,
      treatment_name = v_item.procedure || case when v_item.deposit_charge_id is not null then ' - Balance' else '' end,
      tooth_number = v_item.tooth_number
    where id = v_item.charge_id;
  end if;
  -- Any other status (Invoiced, or anything else in the future) is left
  -- completely untouched - that charge is now financial history.
end;
$$;

/* ============================================================ */
/* 4. add_treatment_deposit / remove_treatment_deposit             */
/* ============================================================ */

create or replace function public.add_treatment_deposit(
  p_treatment_plan_item_id uuid,
  p_deposit_amount numeric
)
returns public.treatment_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.treatment_plan_items;
  v_charge public.clinic_charges;
  v_deposit_charge_id uuid;
  v_balance_amount numeric;
begin
  select * into v_item from public.treatment_plan_items
  where id = p_treatment_plan_item_id
  for update;

  if v_item.id is null then
    raise exception 'Treatment % was not found.', p_treatment_plan_item_id;
  end if;

  if v_item.deposit_charge_id is not null then
    raise exception 'This treatment is already on a deposit + balance plan.';
  end if;

  if v_item.charge_id is null then
    raise exception 'This treatment has no charge yet - it may have a zero price.';
  end if;

  select * into v_charge from public.clinic_charges
  where id = v_item.charge_id
  for update;

  if v_charge.status <> 'Pending' then
    raise exception 'This treatment has already been invoiced, so it can no longer be split into a deposit and balance.';
  end if;

  if p_deposit_amount is null or p_deposit_amount <= 0 then
    raise exception 'Enter a deposit amount greater than zero.';
  end if;

  if p_deposit_amount >= v_charge.amount then
    raise exception 'The deposit must be less than the full treatment amount of %.', v_charge.amount;
  end if;

  v_balance_amount := v_charge.amount - p_deposit_amount;

  insert into public.clinic_charges (
    clinic_id, patient_id, tooth_number, treatment_name, amount, status, treatment_plan_item_id
  )
  values (
    v_charge.clinic_id, v_charge.patient_id, v_charge.tooth_number,
    v_item.procedure || ' - Deposit', p_deposit_amount, 'Pending', v_item.id
  )
  returning id into v_deposit_charge_id;

  update public.clinic_charges
  set amount = v_balance_amount, treatment_name = v_item.procedure || ' - Balance'
  where id = v_charge.id;

  update public.treatment_plan_items
  set deposit_charge_id = v_deposit_charge_id
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

grant execute on function public.add_treatment_deposit(uuid, numeric) to authenticated;

create or replace function public.remove_treatment_deposit(
  p_treatment_plan_item_id uuid
)
returns public.treatment_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.treatment_plan_items;
  v_deposit_charge public.clinic_charges;
  v_balance_charge public.clinic_charges;
begin
  select * into v_item from public.treatment_plan_items
  where id = p_treatment_plan_item_id
  for update;

  if v_item.id is null then
    raise exception 'Treatment % was not found.', p_treatment_plan_item_id;
  end if;

  if v_item.deposit_charge_id is null then
    raise exception 'This treatment is not on a deposit + balance plan.';
  end if;

  select * into v_deposit_charge from public.clinic_charges
  where id = v_item.deposit_charge_id
  for update;

  select * into v_balance_charge from public.clinic_charges
  where id = v_item.charge_id
  for update;

  if v_deposit_charge.status <> 'Pending' or v_balance_charge.status <> 'Pending' then
    raise exception 'Both the deposit and balance must still be unpaid/uninvoiced to undo the split.';
  end if;

  update public.clinic_charges
  set amount = v_deposit_charge.amount + v_balance_charge.amount, treatment_name = v_item.procedure
  where id = v_balance_charge.id;

  delete from public.clinic_charges where id = v_deposit_charge.id;

  update public.treatment_plan_items
  set deposit_charge_id = null
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

grant execute on function public.remove_treatment_deposit(uuid) to authenticated;
