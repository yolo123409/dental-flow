-- Phase H: closes the gap Phase G left open on purpose - canonical
-- Treatment creation (create_treatment_with_teeth) did not automatically
-- stage a Pending clinic_charges row the way the legacy Tooth Details
-- flow (services/patientTeeth.ts#saveTooth()) always has. "Create
-- Treatment" and "Generate Invoice" (billTreatmentPlanItems) remain two
-- separate actions - this migration only changes WHEN a Pending charge
-- first comes into existence, not how/when it becomes an invoice.
--
-- Billable test mirrors saveTooth()'s own existing convention exactly
-- (treatment != "" and estimated_cost > 0), applied here as
-- p_estimated_price > 0 - the per-unit/per-tooth price, not the total,
-- since a Treatment with a real price but quantity 0 (impossible in
-- practice) or a genuinely free/no-charge Treatment (price 0) should
-- never get a meaningless zero-value Pending charge.
--
-- sync_treatment_charge_amount() is the one place that "make this
-- Treatment's Pending charge match its current price*quantity, creating
-- one if it doesn't have one yet and is now billable" logic lives -
-- called from create_treatment_with_teeth (creation), from
-- update_treatment_teeth (a teeth edit changes quantity), and from
-- services/treatmentPlans.ts#updateTreatmentItem (a price/procedure
-- edit) - so the formula is defined exactly once, not duplicated across
-- three call sites. Calling one plpgsql function from another inside the
-- same statement/transaction is fully atomic in Postgres, so this reuse
-- doesn't weaken the atomicity guarantee create_treatment_with_teeth and
-- update_treatment_teeth already had.
--
-- Critically, it never touches an already-Invoiced charge - only a
-- charge with status = 'Pending' (or no charge at all yet) is ever
-- created or modified here. An invoiced charge's amount is financial
-- history and is never rewritten by an edit, matching every prior
-- phase's rule.

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
    update public.clinic_charges
    set
      amount = v_item.estimated_price * v_item.quantity,
      treatment_name = v_item.procedure,
      tooth_number = v_item.tooth_number
    where id = v_item.charge_id;
  end if;
  -- Any other status (Invoiced, or anything else in the future) is left
  -- completely untouched - that charge is now financial history.
end;
$$;

/* ============================================================ */
/* create_treatment_with_teeth - now auto-stages a Pending charge */
/* ============================================================ */
-- Same signature as 0073/0076 (create or replace, not a new function).
-- Only change: delegates to sync_treatment_charge_amount() right after
-- the treatment_plan_items/treatment_teeth inserts, and re-selects the
-- item so the returned row reflects charge_id if one was created.

create or replace function public.create_treatment_with_teeth(
  p_treatment_plan_id uuid,
  p_procedure text,
  p_tooth_numbers integer[],
  p_estimated_price numeric,
  p_quantity integer,
  p_notes text,
  p_priority text,
  p_status text
)
returns public.treatment_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_sort_order integer;
  v_item public.treatment_plan_items;
begin
  select clinic_id into v_clinic_id
  from public.treatment_plans
  where id = p_treatment_plan_id;

  if v_clinic_id is null then
    raise exception 'Treatment plan % was not found.', p_treatment_plan_id;
  end if;

  select count(*) into v_sort_order
  from public.treatment_plan_items
  where treatment_plan_id = p_treatment_plan_id;

  insert into public.treatment_plan_items (
    clinic_id, treatment_plan_id, procedure, tooth_number,
    estimated_price, quantity, notes, priority, status, sort_order
  )
  values (
    v_clinic_id,
    p_treatment_plan_id,
    p_procedure,
    case when array_length(p_tooth_numbers, 1) = 1 then p_tooth_numbers[1] else null end,
    p_estimated_price,
    p_quantity,
    p_notes,
    p_priority,
    p_status,
    v_sort_order
  )
  returning * into v_item;

  insert into public.treatment_teeth (clinic_id, treatment_plan_item_id, tooth_number)
  select v_clinic_id, v_item.id, tooth
  from unnest(p_tooth_numbers) as tooth
  on conflict (treatment_plan_item_id, tooth_number) do nothing;

  perform public.sync_treatment_charge_amount(v_item.id);

  select * into v_item
  from public.treatment_plan_items
  where id = v_item.id;

  return v_item;
end;
$$;

/* ============================================================ */
/* update_treatment_teeth - blocks on charge STATUS, not presence */
/* ============================================================ */
-- Same signature as 0077 (create or replace, not a new function). Phase
-- H changes what treatment_plan_items.charge_id being set means: before
-- this migration it only ever became non-null right before invoicing
-- (billTreatmentPlanItems), so "has a charge_id" and "already invoiced"
-- were the same thing. Now every billable Treatment gets a charge_id
-- immediately on creation, while still Pending - so the correct guard is
-- the charge's own status, not merely whether charge_id is set. An
-- uninvoiced (Pending) Treatment's teeth remain editable, and its
-- charge's amount/tooth_number are kept in sync via
-- sync_treatment_charge_amount(); an Invoiced charge still blocks the
-- edit exactly as 0077 already did.

create or replace function public.update_treatment_teeth(
  p_treatment_plan_item_id uuid,
  p_tooth_numbers integer[]
)
returns public.treatment_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.treatment_plan_items;
  v_charge_status text;
  v_new_count integer;
begin
  select * into v_item
  from public.treatment_plan_items
  where id = p_treatment_plan_item_id;

  if v_item.id is null then
    raise exception 'Treatment % was not found.', p_treatment_plan_item_id;
  end if;

  if v_item.charge_id is not null then
    select status into v_charge_status
    from public.clinic_charges
    where id = v_item.charge_id;

    if v_charge_status is distinct from 'Pending' then
      raise exception 'This treatment has already been invoiced, so its teeth can no longer be changed.';
    end if;
  end if;

  delete from public.treatment_teeth
  where treatment_plan_item_id = p_treatment_plan_item_id;

  insert into public.treatment_teeth (clinic_id, treatment_plan_item_id, tooth_number)
  select v_item.clinic_id, v_item.id, tooth
  from unnest(p_tooth_numbers) as tooth
  on conflict (treatment_plan_item_id, tooth_number) do nothing;

  v_new_count := array_length(p_tooth_numbers, 1);

  update public.treatment_plan_items
  set
    tooth_number = case when v_new_count = 1 then p_tooth_numbers[1] else null end,
    quantity = case when v_new_count > 0 then v_new_count else quantity end,
    updated_at = now()
  where id = p_treatment_plan_item_id
  returning * into v_item;

  perform public.sync_treatment_charge_amount(v_item.id);

  select * into v_item
  from public.treatment_plan_items
  where id = v_item.id;

  return v_item;
end;
$$;
