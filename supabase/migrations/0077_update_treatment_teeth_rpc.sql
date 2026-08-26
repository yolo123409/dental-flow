-- Phase D: atomic editing of an existing Treatment's tooth associations
-- (section 10/11 of the Phase D spec - "Editing Treatments"). Mirrors
-- create_treatment_with_teeth (0073/0076): a single plpgsql function body
-- is atomic on its own (an unhandled exception rolls back everything it
-- did), so this replaces the whole tooth set in one call rather than a
-- client-side delete-then-insert pair - the UI can never end up showing
-- "16, 17" while the database still has "16, 17, 18" because the second
-- step failed.
--
-- Billing safety (section 12): once a Treatment has been invoiced
-- (treatment_plan_items.charge_id is set - the same signal
-- billTreatmentPlanItems() already treats as the "already billed"
-- boundary, see services/treatmentPlans.ts), its tooth associations are
-- frozen. Quantity is derived from the teeth count wherever the existing
-- billing model already ties them together (estimated_price is a
-- per-tooth price - see 0073's own comment and Phase C's report), so
-- letting an invoiced item's teeth change would silently change the
-- financial meaning of a charge/invoice line that has already been
-- created - exactly what section 12 prohibits. This is enforced here at
-- the database level (not just client-side) so it holds regardless of
-- caller. No new accounting behavior is invented: this simply refuses
-- the write and reports why, the same "fail loudly, never silently
-- corrupt" posture as create_treatment_with_teeth's own validation.
--
-- security invoker (not definer), same reasoning as 0073: the existing
-- RLS policies on treatment_plan_items/treatment_teeth already enforce
-- clinic isolation, so running as the caller means this function
-- inherits that protection for free.

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
  v_new_count integer;
begin
  select * into v_item
  from public.treatment_plan_items
  where id = p_treatment_plan_item_id;

  if v_item.id is null then
    raise exception 'Treatment % was not found.', p_treatment_plan_item_id;
  end if;

  if v_item.charge_id is not null then
    raise exception 'This treatment has already been invoiced, so its teeth can no longer be changed.';
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
    -- Same rule as create_treatment_with_teeth: the legacy single-tooth
    -- column reflects exactly one tooth, or null for "many" or "none".
    tooth_number = case when v_new_count = 1 then p_tooth_numbers[1] else null end,
    -- Quantity tracks teeth count only when there ARE teeth (the
    -- established per-tooth-price rule from Phase C) - a Treatment being
    -- edited down to zero teeth keeps its existing quantity rather than
    -- being forced to some arbitrary value, since a no-tooth Treatment's
    -- quantity is independently meaningful (e.g. "3x consultation").
    quantity = case when v_new_count > 0 then v_new_count else quantity end,
    updated_at = now()
  where id = p_treatment_plan_item_id
  returning * into v_item;

  return v_item;
end;
$$;
