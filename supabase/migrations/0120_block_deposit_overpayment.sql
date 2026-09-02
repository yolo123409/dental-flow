-- Full-app audit fix H2 (High): sync_treatment_charge_amount's
-- deposit-aware branch (migration 0112) floors the balance charge at
-- greatest(0, new_total - deposit_amount) - if a price cut drops the new
-- total below an already-collected deposit, the balance silently goes to
-- 0 with the resulting overpayment invisible everywhere (no error, no
-- flag, no reconciliation-issue row). E.g. a 1000 treatment with a 600
-- deposit, then the price is reduced so the new total is 500: the old
-- code set the balance to greatest(0, 500 - 600) = 0, leaving the clinic
-- having collected/invoiced 600 against a now-500 treatment with nothing
-- anywhere recording the 100 overage.
--
-- THE FIX: block instead of silently corrupt - the same "refuse the
-- operation rather than allow an inconsistent financial state" pattern
-- this codebase already uses throughout (void_invoice's amount_paid > 0
-- guard, add_treatment_deposit's own deposit-must-be-less-than-total
-- check). If the computed target would go negative, raise a clear error
-- instead of flooring to 0 - the caller (updateTreatmentItem(), services/
-- treatmentPlans.ts) already propagates a thrown error from this RPC as
-- a normal failure.
--
-- Every other line is unchanged from migration 0112 - same signature,
-- same non-deposit behavior, same "never touch an Invoiced charge" rule.
--
-- Safe to re-run: create or replace function, same signature.

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

      -- Full-app audit fix H2: block rather than silently floor at 0 -
      -- see this migration's header comment.
      if v_target_amount - coalesce(v_deposit_amount, 0) < 0 then
        raise exception 'This treatment''s new price (%) is less than its already-collected deposit (%) - increase the price, remove the deposit split, or issue a refund/credit first.', v_target_amount, v_deposit_amount;
      end if;

      v_target_amount := v_target_amount - coalesce(v_deposit_amount, 0);
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
