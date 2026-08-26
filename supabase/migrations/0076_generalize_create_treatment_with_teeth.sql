-- Phase D: unifies every Treatment creation path (odontogram multi-select,
-- Treatment Plan "+ Add Treatment", single-tooth) onto ONE canonical
-- service (createTreatment() in services/treatmentPlans.ts), which always
-- calls this RPC. That includes a Treatment that isn't tied to any tooth
-- at all (a consultation, a general exam, oral hygiene instruction, etc.
-- per the existing catalogue) - a case create_treatment_with_teeth (0073)
-- previously rejected outright with "At least one tooth number is
-- required."
--
-- Same signature as 0073 (create or replace, not a new function), so
-- every existing caller keeps working unchanged - only that guard is
-- removed. unnest() of a null or empty array already produces zero rows
-- on its own, so passing p_tooth_numbers = '{}' (or null) simply creates
-- zero treatment_teeth rows with no extra casing needed; the existing
-- array_length(...) = 1 check already correctly leaves the legacy
-- tooth_number column null whenever there isn't exactly one tooth,
-- covering the zero-teeth case for free.

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
  -- Reading treatment_plans is already RLS-scoped to the caller's own
  -- clinic, so a v_clinic_id found here is guaranteed to be theirs - the
  -- inserts below rely on that same guarantee rather than trusting a
  -- client-supplied clinic id.
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
    -- The legacy single-tooth compatibility column: populated only when
    -- there's exactly one tooth, null for both "many teeth" and "no
    -- tooth at all" - never a placeholder/first-of-many value that would
    -- misrepresent either case as single-tooth.
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

  return v_item;
end;
$$;
