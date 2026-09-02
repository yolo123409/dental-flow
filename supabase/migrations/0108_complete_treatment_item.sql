-- Appointment Completion -> Billing (Phase B/C), Issue 2 resolution: the
-- billing trigger is the TREATMENT reaching Completed, never merely an
-- appointment being completed - a multi-visit treatment (root canal across
-- 3 visits) must not be billed in full the moment visit 1's appointment is
-- marked done. Completing an appointment linked to a treatment only asks
-- the clinician "is this treatment now fully complete?"; a YES is what
-- calls this function.
--
-- Issue 1 resolution (treatment-instance-level serialization): several
-- DIFFERENT appointments can legitimately point at the SAME
-- treatment_plan_item (multi-visit). A lock on the appointment row alone
-- (one candidate design, rejected) does not protect against two DIFFERENT
-- appointments for the same treatment being completed concurrently - both
-- would reach this point with different appointment locks. The lock
-- belongs on the treatment instance itself: `for update` on
-- treatment_plan_items serializes every concurrent attempt to complete
-- THIS treatment, regardless of which appointment (or the Treatment Plan
-- UI directly) triggered it. The loser sees status already 'Completed'
-- and returns null - its caller must not proceed to bill.
--
-- security invoker (not definer): this table's existing protections -
-- RLS clinic-membership + trg_guard_treatment_plan_item_role (migration
-- 0097, Owner/Admin/Dentist only for a status/procedure/price change) -
-- already apply correctly to a security invoker function, exactly like
-- create_treatment_with_teeth/update_treatment_teeth/
-- sync_treatment_charge_amount already do. No new permission is invented:
-- a Dentist can confirm their own clinical work is done; a Receptionist
-- (has "billing", not "treatments") cannot, and is blocked by the same
-- existing trigger - the application layer mirrors this by gating the
-- confirmation prompt behind the "treatments" permission.
--
-- Reuses sync_treatment_charge_amount() (migration 0080) completely
-- unchanged to ensure/reuse the treatment's Pending charge - no new
-- charge-creation logic, no second accounting path.

create or replace function public.complete_treatment_item(
  p_treatment_plan_item_id uuid
)
returns public.treatment_plan_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.treatment_plan_items;
begin
  select * into v_item
  from public.treatment_plan_items
  where id = p_treatment_plan_item_id
  for update;

  if v_item.id is null then
    raise exception 'Treatment % was not found.', p_treatment_plan_item_id;
  end if;

  if v_item.status = 'Completed' then
    -- Idempotent: another request already completed this treatment
    -- (whether via a different linked appointment, or directly through
    -- the Treatment Plan UI). The caller must not proceed to bill again.
    return null;
  end if;

  update public.treatment_plan_items
  set status = 'Completed', updated_at = now()
  where id = p_treatment_plan_item_id;

  perform public.sync_treatment_charge_amount(p_treatment_plan_item_id);

  select * into v_item
  from public.treatment_plan_items
  where id = p_treatment_plan_item_id;

  return v_item;
end;
$$;

grant execute on function public.complete_treatment_item(uuid) to authenticated;
