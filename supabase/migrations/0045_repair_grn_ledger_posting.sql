-- ============================================================
-- Accounts Payable reconciliation repair.
--
-- ROOT CAUSE (confirmed by live inspection, not guessed):
--   trg_post_grn_ledger (0043) posts Dr Inventory / Cr Accounts Payable
--   on the UPDATE that flips a GRN's status to 'Received'. It was
--   verified empirically against the live database that this trigger
--   fires correctly today (a disposable test GRN received just now
--   produced the expected ledger transaction, then was cleaned up).
--   The GRNs behind the current KES 0 vs GRN-based mismatch were all
--   marked 'Received' BEFORE migration 0043 (and its trigger) existed
--   in this database, so the trigger never ran for them - there is no
--   bug in the trigger, and no reconciliation issue was logged for
--   them, because the trigger genuinely didn't exist yet at the time
--   they were received (an exception handler can't catch an event
--   that never occurred). This migration adds a narrow, Owner/Admin-
--   only, idempotent repair path for exactly that gap - it does not
--   change _post_ledger_transaction, does not change
--   trg_post_grn_ledger, and does not touch 0043/0044.
-- ============================================================

/* ============================================================ */
/* Repair: post the missing Dr Inventory / Cr A/P transaction for */
/* every Received GRN of one supplier that has none yet. Reuses   */
/* _post_ledger_transaction (0043) directly - no second posting    */
/* mechanism. Idempotent: a GRN that already has a live (non-      */
/* reversed) 'grn' transaction is skipped, and the existing unique  */
/* index on (clinic_id, reference_type, reference_id) is an extra   */
/* backstop against a duplicate insert even under a race.           */
/* ============================================================ */

create or replace function public.repair_supplier_grn_ledger_postings(p_supplier_id uuid)
returns table (
  grn_id uuid,
  grn_number text,
  amount numeric,
  ledger_transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_supplier record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_grn record;
  v_total numeric;
  v_existing uuid;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can repair ledger postings';
  end if;

  select * into v_supplier from public.clinic_suppliers s
  where s.id = p_supplier_id and s.clinic_id = v_clinic_id;

  if v_supplier.id is null then
    raise exception 'Supplier not found for this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.inventory_account_id is null or v_settings.accounts_payable_account_id is null then
    raise exception 'Inventory or Accounts Payable account is not configured - set it in Accounting Settings first';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  for v_grn in
    select g.id, g.grn_number, g.date_received
    from public.clinic_goods_received_notes g
    where g.clinic_id = v_clinic_id and g.supplier_id = p_supplier_id and g.status = 'Received'
    order by g.date_received
    for update
  loop
    select t.id into v_existing from public.clinic_ledger_transactions t
    where t.clinic_id = v_clinic_id and t.reference_type = 'grn' and t.reference_id = v_grn.id
      and t.reversed_by is null;

    if v_existing is not null then
      continue;
    end if;

    select coalesce(sum(gi.quantity_received * gi.unit_cost), 0) into v_total
    from public.clinic_grn_items gi
    where gi.grn_id = v_grn.id;

    if v_total <= 0 then
      continue;
    end if;

    v_new_id := public._post_ledger_transaction(
      v_clinic_id, v_grn.date_received, 'InventoryReceipt', 'grn', v_grn.id,
      'Goods received (reconciliation repair): ' || v_grn.grn_number, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.inventory_account_id, 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.accounts_payable_account_id, 'debit', 0, 'credit', v_total)
      ),
      null, p_supplier_id, v_clinic_user_id, null
    );

    grn_id := v_grn.id;
    grn_number := v_grn.grn_number;
    amount := v_total;
    ledger_transaction_id := v_new_id;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.repair_supplier_grn_ledger_postings(uuid) to authenticated;
