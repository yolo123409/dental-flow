-- Phase C of the Treatment/Procedure architecture redesign: the odontogram
-- multi-tooth selection needs to create ONE treatment_plan_items row
-- associated with MANY treatment_teeth rows (0072_treatment_teeth.sql) as
-- a single atomic operation - so a dentist never ends up with a treatment
-- that silently applies to only some of the teeth they selected because a
-- later insert in a client-side loop happened to fail.
--
-- Mirrors the one existing precedent for this kind of "must succeed
-- together" multi-table write in this schema: create_clinic_with_admin
-- (0001_multi_tenant_onboarding.sql). Uses SECURITY INVOKER (not
-- DEFINER) deliberately - the existing RLS policies on treatment_plans,
-- treatment_plan_items and treatment_teeth already enforce clinic
-- isolation correctly, and running as the caller means this function
-- inherits that same protection for free rather than needing to
-- reimplement it. A plpgsql function body is itself atomic (an
-- unhandled exception rolls back everything it did), so no explicit
-- transaction handling is needed here.
--
-- Deliberately NOT touched: clinic_charges, clinic_invoices,
-- clinic_invoice_items, patient_teeth, or any billing function - this
-- only ever creates clinical/planning records, exactly like
-- createTreatmentItem() already does.

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
  if p_tooth_numbers is null or array_length(p_tooth_numbers, 1) is null then
    raise exception 'At least one tooth number is required.';
  end if;

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
    -- there's exactly one tooth, matching what every existing reader of
    -- tooth_number already expects (a single tooth or null) - never a
    -- placeholder/first-of-many value that would misrepresent a grouped
    -- treatment as single-tooth.
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
