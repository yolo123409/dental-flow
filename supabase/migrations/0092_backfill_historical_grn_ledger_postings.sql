-- FIN-3.3: one-time historical backfill of missing GRN (goods received)
-- ledger postings - the same "MOGENI GRN gap" identified back in the FIN-0
-- audit, now closed following the exact Phase N/P/FIN-3.3-expense pattern:
-- reusing _post_ledger_transaction(), never inventing a new repair
-- mechanism.
--
-- ROOT CAUSE: _trigger_post_grn_ledger() (migration 0043) is an AFTER
-- UPDATE trigger firing on the status transition to 'Received', so it
-- cannot retroactively post for a GRN that already transitioned before the
-- ledger's Inventory/Accounts Payable account configuration was fully in
-- place for this clinic. clinic_ledger_reconciliation_issues has zero rows
-- for any of the 3 candidates, ruling out the trigger's own error-handling
-- path.
--
-- NOTE ON CONFIDENCE: unlike the invoice/payment/expense gaps (each showing
-- a clean "nothing before date X ever posted" cutoff), this clinic's GRN
-- postings are interleaved - 3 GRNs posted successfully starting
-- 2026-08-06, while these 3 candidates (received_at 2026-08-13) did not.
-- The exact trigger-side mechanism for these specific 3 is therefore
-- UNVERIFIED beyond "no ledger transaction and no reconciliation issue
-- exists for them" - reported honestly rather than assumed. This does not
-- change the safety of the backfill itself: Inventory and Accounts
-- Payable are both configured for this clinic today, Accounts Payable has
-- no automatic reduction mechanism anywhere in this system (migration
-- 0043's own header comment: "Money Out expenses never automatically
-- debit Accounts Payable"), so adding these 3 GRNs' AP credit cannot
-- clash with anything already posted against that account.
--
-- SCOPE: exactly the 3 Received GRNs for this one clinic with no existing
-- GRN-type ledger posting - dynamically discovered and hard-guarded below,
-- never a hardcoded ID list.
--
-- ACCOUNTING STRUCTURE: reproduces _trigger_post_grn_ledger() exactly -
-- Debit Inventory / Credit Accounts Payable, for
-- sum(grn_items.quantity_received * grn_items.unit_cost), dated on each
-- GRN's own date_received (never today's date), description formatted
-- exactly as the trigger's own "Goods received: <grn_number>", and each
-- GRN's own supplier_id/received_by carried onto its transaction row.
--
-- SAFETY: single atomic DO block. Before any write, independently
-- recomputes the candidate set and refuses to write anything unless the
-- count and total exactly match this migration's own investigation (3
-- GRNs, KES 104,000.00) - a drift means live data has changed since this
-- was written, and the migration aborts loudly rather than guessing.
--
-- IDEMPOTENCY: the "NOT EXISTS (a GRN-type posting for this GRN)" clause
-- is the entire idempotency guard - a second run finds zero candidates and
-- exits cleanly via RAISE NOTICE without writing anything.

do $$
declare
  v_clinic_id uuid := 'ed2d8fb6-3603-47bd-ac8e-061a324a489d';

  v_inventory_account_id uuid;
  v_accounts_payable_account_id uuid;
  v_currency text;

  v_expected_total numeric(12, 2) := 104000.00;
  v_expected_count integer := 3;

  v_computed_total numeric(12, 2);
  v_candidate_count integer;

  r record;
begin
  -- 1. Inventory / Accounts Payable accounts must be configured for this
  -- clinic - if either is missing, the live trigger itself couldn't post,
  -- and neither can this backfill.
  select ls.inventory_account_id, ls.accounts_payable_account_id
    into v_inventory_account_id, v_accounts_payable_account_id
  from public.clinic_ledger_settings ls
  where ls.clinic_id = v_clinic_id;

  if v_inventory_account_id is null or v_accounts_payable_account_id is null then
    raise exception
      'FIN-3.3 GRN backfill ABORTED: Inventory or Accounts Payable account is not configured for clinic %. Nothing written.',
      v_clinic_id;
  end if;

  select coalesce(cs.currency, 'KES') into v_currency
  from public.clinic_settings cs
  where cs.clinic_id = v_clinic_id;

  v_currency := coalesce(v_currency, 'KES');

  -- 2. Dynamically (re-)discover candidate GRNs and their real received
  -- totals - never a hardcoded GRN list.
  create temp table _fin33_grn_candidates on commit drop as
  select
    g.id as grn_id,
    g.grn_number,
    g.date_received,
    g.supplier_id,
    g.received_by,
    coalesce((select sum(gi.quantity_received * gi.unit_cost) from public.clinic_grn_items gi where gi.grn_id = g.id), 0)::numeric(12, 2) as total
  from public.clinic_goods_received_notes g
  where g.clinic_id = v_clinic_id
    and g.status = 'Received'
    and not exists (
      select 1
      from public.clinic_ledger_transactions t
      where t.clinic_id = g.clinic_id
        and t.reference_type = 'grn'
        and t.reference_id = g.id
    );

  select count(*), coalesce(sum(total), 0)
    into v_candidate_count, v_computed_total
  from _fin33_grn_candidates;

  raise notice
    'FIN-3.3 GRN backfill: % candidate GRN(s) found, computed total = %',
    v_candidate_count, v_computed_total;

  -- 3. Idempotency: a prior run already posted everything in scope.
  if v_candidate_count = 0 then
    raise notice
      'FIN-3.3 GRN backfill: no candidates found (already applied, or nothing to backfill) - exiting without writing anything.';
    return;
  end if;

  -- 4. Hard safety guard: refuse to write anything unless live data still
  -- matches this migration's own investigation exactly.
  if v_computed_total <> v_expected_total then
    raise exception
      'FIN-3.3 GRN backfill ABORTED: computed total (%) does not match the expected KES %. Live data has drifted since this migration was written - refusing to write.',
      v_computed_total, v_expected_total;
  end if;

  if v_candidate_count <> v_expected_count then
    raise exception
      'FIN-3.3 GRN backfill ABORTED: expected exactly % candidate GRN(s), found %. Refusing to write.',
      v_expected_count, v_candidate_count;
  end if;

  if exists (select 1 from _fin33_grn_candidates where total <= 0) then
    raise exception
      'FIN-3.3 GRN backfill ABORTED: at least one candidate has a non-positive total, which cannot be posted. Refusing to write.';
  end if;

  -- 5. All safety checks passed - post one balanced, two-legged
  -- InventoryReceipt transaction per candidate, reproducing exactly the
  -- structure _trigger_post_grn_ledger() uses for a normal GRN today.
  for r in select * from _fin33_grn_candidates order by date_received loop
    perform public._post_ledger_transaction(
      v_clinic_id, r.date_received, 'InventoryReceipt', 'grn', r.grn_id,
      'Goods received: ' || r.grn_number, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', v_inventory_account_id, 'debit', r.total, 'credit', 0),
        jsonb_build_object('account_id', v_accounts_payable_account_id, 'debit', 0, 'credit', r.total)
      ),
      null, r.supplier_id, r.received_by, null
    );

    raise notice
      'FIN-3.3 GRN backfill: posted % (%) - amount %',
      r.grn_number, r.grn_id, r.total;
  end loop;

  raise notice
    'FIN-3.3 GRN backfill COMPLETE: % GRN(s) posted, total = %',
    v_candidate_count, v_computed_total;
end $$;
