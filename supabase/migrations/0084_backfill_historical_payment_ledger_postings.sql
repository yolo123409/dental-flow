-- Phase P: one-time historical backfill of missing Payment ledger
-- postings, closing the safely-closable part of the gap Phase O's
-- independent, read-only audit proved.
--
-- ROOT CAUSE: same structural cause as Phase N's Invoice-side gap -
-- _trigger_post_payment_ledger() (migration 0043) is an AFTER INSERT
-- trigger on clinic_payments, so it cannot retroactively post for
-- payment rows that already existed before the ledger trigger
-- infrastructure went live for this clinic.
--
-- SCOPE NARROWED FROM PHASE O's ORIGINAL 25-PAYMENT / KES 350,240.00
-- FINDING - two structural conflicts were discovered by this
-- migration's own dry runs (never written to the live database) before
-- any decision was made, and the user was shown the exact numbers and
-- explicitly chose the safe subset below:
--
--   1. Posting ONLY the payment-side credit for all 25 (Phase P's
--      original literal instruction, "payment transactions only")
--      mathematically breaks Accounts Receivable: every payment's other
--      ledger leg is Cash, not AR, so crediting AR alone drops Ledger AR
--      by the full backfilled amount with nothing to offset it.
--
--   2. Backfilling BOTH sides for all 17 affected invoices is not
--      possible either, for two independent reasons discovered on two
--      of them specifically:
--        - INV-00012 and INV-00018 already have ONE Invoice-type ledger
--          transaction each (Phase N, migration 0081), deliberately
--          posted for less than their full total. The database's own
--          existing duplicate-posting backstop -
--          idx_clinic_ledger_transactions_reference_unique (migration
--          0044) - allows at most ONE ledger transaction per
--          (clinic_id, reference_type, reference_id). A second
--          Invoice-type "top-up" transaction for either invoice is
--          therefore not just inadvisable, it is REJECTED BY THE
--          DATABASE ITSELF - and editing Phase N's already-committed
--          transaction is off the table (no existing ledger transaction
--          may be modified). Their 2 payments (KES 40 + KES 10,000)
--          cannot be safely backfilled by this or any similarly-scoped
--          migration.
--        - INV-00007 and INV-00010 are the two invoices Phase O's
--          separate O1 audit found to be genuinely overpaid (negative
--          balance). Fully and honestly posting their real history
--          (Invoice debit = full total, Payment credits = full amount
--          paid, including the overpaid portion) is technically
--          possible, but the resulting net ledger contribution for each
--          is their real, negative balance rather than 0 - which
--          permanently and correctly shifts the AGGREGATE Ledger AR
--          balance away from the floor-at-zero Outstanding Invoice AR
--          figure by exactly their combined overpayment
--          (KES 1,003.48) - the same distinction Phase O already
--          documented between getInvoiceBalanceTotals() (nets
--          overpayments) and getOutstandingInvoiceBalance() (floors at
--          zero). This is not a bug, but it does mean "Ledger AR remains
--          exactly KES 1,890,320.00" would no longer hold if these two
--          are included.
--
-- THE APPROVED SCOPE (this migration): exactly the invoices where
-- NEITHER side was ever posted AND the invoice is fully paid with a
-- balance of precisely 0 (never negative/overpaid, never still
-- outstanding) - 13 invoices, 19 payments, KES 271,200.00. For every one
-- of these, posting the full Invoice-type debit (= invoice.total) and
-- every payment's Payment-type credit together nets to exactly 0 per
-- invoice, matching their real balance exactly and leaving the
-- aggregate Ledger AR mathematically untouched. INV-00007, INV-00010,
-- INV-00012, INV-00018 (4 invoices, KES 79,040.00 across 6 payments) are
-- deliberately left untouched by this migration for a future,
-- separately-scoped and separately-approved phase - they are NOT
-- silently ignored; Phase P's final report documents them explicitly.
--
-- WHY BOTH SIDES, NOT JUST PAYMENT: unlike Phase N (which only needed to
-- post the Invoice side, since every payment for its 13 invoices already
-- had a valid Payment-type posting or the invoice was still genuinely
-- outstanding), these 13 invoices have NEITHER side posted at all -
-- Phase N's own candidate query correctly excluded them (they didn't
-- have balance > 0 or any posted payment credit at the time). Posting
-- only one side here would - as proven above - break AR. Posting both
-- together, for exactly this "fully paid, zero balance, zero footprint"
-- subset, is the only combination that is both safe and correct.
--
-- WHY CASH FLOW IS AFFECTED: getCashFlowStatement() derives
-- Operating/collections entirely from the ledger, not clinic_payments
-- directly (confirmed by Phase O's code audit) - so the Cash debit legs
-- this migration posts (via the Payment-type transactions) are what
-- closes the historical Operating-collections gap for these 13
-- invoices' dates.
--
-- WHY DYNAMIC DISCOVERY: nothing below is a hardcoded invoice or payment
-- ID list. A payment qualifies only if (a) it has no existing
-- Payment-type posting, AND (b) its invoice has no existing Invoice-type
-- posting AND a balance of exactly 0 - conditions that structurally
-- exclude INV-00007/00010 (nonzero balance) and INV-00012/00018
-- (already has an Invoice-type posting) without naming any of them. The
-- block refuses to write anything unless the freshly discovered count
-- and total exactly match the approved scope (19 payments,
-- KES 271,200.00; 13 invoice postings, KES 271,200.00).
--
-- ACCOUNTING STRUCTURE: Payment-type postings reproduce
-- _trigger_post_payment_ledger() exactly (Debit Cash/Bank - resolved per
-- payment_method via the same clinic_ledger_settings.payment_method_accounts
-- mapping, falling back to default_cash_account_id - Credit Accounts
-- Receivable). Invoice-type postings reproduce
-- _trigger_post_invoice_ledger() exactly (Debit Accounts Receivable,
-- Credit Treatment Revenue, for the invoice's full total - these 13 have
-- no existing posting to top up, so this is their first and only one,
-- same as a normal invoice). Both call the already-existing
-- _post_ledger_transaction() helper - the same one both triggers call
-- today. Neither trigger, nor migration 0081, is modified.
--
-- SAFETY: everything below runs inside one DO block (a single atomic
-- unit). Before any write, the block independently recomputes the
-- candidate set, its total dollar amount, and the pre/post AR balance
-- (both the unfloored Ledger AR figure and the floor-at-zero Outstanding
-- Invoice AR figure), refusing to write unless every guard passes and
-- the two remain EXACTLY equal to their pre-backfill values afterward.
--
-- IDEMPOTENCY: the "NOT EXISTS (a Payment-type/Invoice-type posting
-- already referencing this row)" clauses are the entire idempotency
-- guard - running this migration a second time finds zero candidates
-- (every qualifying payment/invoice now already has its posting) and
-- exits cleanly via RAISE NOTICE without inserting anything.
--
-- No RLS policy is touched, and no new SECURITY DEFINER function is
-- introduced - this migration calls the already-existing
-- _post_ledger_transaction() helper (itself SECURITY DEFINER, already
-- granted, already used by both live triggers).

do $$
declare
  v_clinic_id uuid := 'ed2d8fb6-3603-47bd-ac8e-061a324a489d';

  v_ar_account_id uuid;
  v_ar_account_code text;
  v_revenue_account_id uuid;
  v_default_cash_account_id uuid;
  v_payment_method_accounts jsonb;
  v_currency text;

  v_expected_payment_total numeric(12, 2) := 271200.00;
  v_expected_payment_count integer := 19;
  v_expected_invoice_count integer := 13;

  v_computed_payment_total numeric(12, 2);
  v_payment_candidate_count integer;
  v_computed_invoice_total numeric(12, 2);
  v_invoice_candidate_count integer;

  v_ar_before numeric(12, 2);
  v_ar_after numeric(12, 2);
  v_outstanding_invoice_ar_before numeric(12, 2);
  v_outstanding_invoice_ar_after numeric(12, 2);

  r record;
  ri record;
  v_transaction_id uuid;
  v_new_payment_txn_count integer;
  v_new_invoice_txn_count integer;
begin
  -- 1. Accounts Receivable / Treatment Revenue / default cash account
  -- must be configured for this clinic.
  select ls.accounts_receivable_account_id, ls.treatment_revenue_account_id,
         ls.default_cash_account_id, ls.payment_method_accounts
    into v_ar_account_id, v_revenue_account_id, v_default_cash_account_id, v_payment_method_accounts
  from public.clinic_ledger_settings ls
  where ls.clinic_id = v_clinic_id;

  if v_ar_account_id is null or v_revenue_account_id is null then
    raise exception
      'Phase P backfill ABORTED: Accounts Receivable or Treatment Revenue account is not configured for clinic %. Nothing written.',
      v_clinic_id;
  end if;

  if v_default_cash_account_id is null then
    raise exception
      'Phase P backfill ABORTED: no default cash account configured for clinic %. Nothing written.',
      v_clinic_id;
  end if;

  -- 2. The AR account must be the one Phase N/O actually investigated
  -- (code 1100).
  select code into v_ar_account_code
  from public.clinic_ledger_accounts
  where id = v_ar_account_id;

  if v_ar_account_code is distinct from '1100' then
    raise exception
      'Phase P backfill ABORTED: expected the Accounts Receivable account code to be 1100, found %. Nothing written.',
      v_ar_account_code;
  end if;

  select coalesce(cs.currency, 'KES') into v_currency
  from public.clinic_settings cs
  where cs.clinic_id = v_clinic_id;

  v_currency := coalesce(v_currency, 'KES');

  -- 3. AR balances BEFORE any write, computed independently.
  select coalesce(sum(e.debit) - sum(e.credit), 0)
    into v_ar_before
  from public.clinic_ledger_entries e
  where e.clinic_id = v_clinic_id
    and e.account_id = v_ar_account_id;

  select coalesce(sum(balance), 0)
    into v_outstanding_invoice_ar_before
  from public.clinic_invoices
  where clinic_id = v_clinic_id
    and balance > 0;

  raise notice
    'Phase P backfill: BEFORE - Ledger AR = %, Outstanding Invoice AR = %',
    v_ar_before, v_outstanding_invoice_ar_before;

  -- 4. Dynamically (re-)discover candidate payments. A payment
  -- qualifies only when: it has no existing Payment-type posting, AND
  -- its invoice has no existing Invoice-type posting, AND that
  -- invoice's balance is exactly 0 (fully paid - never negative/
  -- overpaid, never still outstanding). These three conditions
  -- structurally exclude INV-00007/00010 (nonzero balance) and
  -- INV-00012/00018 (already has an Invoice-type posting) without
  -- naming any invoice.
  create temp table _phase_p_payment_candidates on commit drop as
  select
    p.id as payment_id,
    p.invoice_id,
    p.patient_id,
    p.amount,
    p.payment_method,
    p.received_at,
    coalesce(
      (v_payment_method_accounts ->> p.payment_method)::uuid,
      v_default_cash_account_id
    ) as cash_account_id
  from public.clinic_payments p
  join public.clinic_invoices i on i.id = p.invoice_id
  where p.clinic_id = v_clinic_id
    and p.amount > 0
    and abs(i.balance) < 0.01
    and not exists (
      select 1
      from public.clinic_ledger_transactions t2
      where t2.clinic_id = p.clinic_id
        and t2.reference_type = 'payment'
        and t2.reference_id = p.id
    )
    and not exists (
      select 1
      from public.clinic_ledger_transactions t3
      where t3.clinic_id = i.clinic_id
        and t3.reference_type = 'invoice'
        and t3.reference_id = i.id
    );

  select count(*), coalesce(sum(amount), 0)
    into v_payment_candidate_count, v_computed_payment_total
  from _phase_p_payment_candidates;

  raise notice
    'Phase P backfill: % candidate payment(s) found, computed total = %',
    v_payment_candidate_count, v_computed_payment_total;

  -- 5. Idempotency: if a prior run already posted everything in scope,
  -- the candidate set is now empty - exit cleanly, write nothing.
  if v_payment_candidate_count = 0 then
    raise notice
      'Phase P backfill: no payment candidates found (already applied, or nothing in the approved scope to backfill) - exiting without writing anything.';
    return;
  end if;

  -- 6. Hard safety guard: refuse to write anything unless live data
  -- still matches the approved scope exactly.
  if v_computed_payment_total <> v_expected_payment_total then
    raise exception
      'Phase P backfill ABORTED: computed payment backfill total (%) does not match the approved KES % scope. Live data has drifted since approval - refusing to write.',
      v_computed_payment_total, v_expected_payment_total;
  end if;

  if v_payment_candidate_count <> v_expected_payment_count then
    raise exception
      'Phase P backfill ABORTED: expected exactly % candidate payment(s), found %. Refusing to write.',
      v_expected_payment_count, v_payment_candidate_count;
  end if;

  if exists (
    select 1
    from _phase_p_payment_candidates c
    left join public.clinic_ledger_accounts a on a.id = c.cash_account_id and a.active
    where c.cash_account_id is null or a.id is null
  ) then
    raise exception
      'Phase P backfill ABORTED: at least one candidate payment has no resolvable, active cash/bank account for its payment method. Refusing to write.';
  end if;

  if exists (select 1 from _phase_p_payment_candidates where amount <= 0) then
    raise exception
      'Phase P backfill ABORTED: at least one candidate has a non-positive amount. Refusing to write.';
  end if;

  if (select count(*) from _phase_p_payment_candidates) <>
     (select count(distinct payment_id) from _phase_p_payment_candidates) then
    raise exception
      'Phase P backfill ABORTED: duplicate payment ids detected in the candidate set. Refusing to write.';
  end if;

  -- 7. Invoice candidates - the distinct invoices behind the payment
  -- candidates above (every one already guaranteed, by the payment
  -- query's own WHERE clause, to have no existing Invoice-type posting
  -- and a balance of exactly 0).
  create temp table _phase_p_invoice_candidates on commit drop as
  select i.id as invoice_id, i.invoice_number, i.created_at, i.patient_id, i.total
  from public.clinic_invoices i
  where i.id in (select distinct invoice_id from _phase_p_payment_candidates);

  select count(*), coalesce(sum(total), 0)
    into v_invoice_candidate_count, v_computed_invoice_total
  from _phase_p_invoice_candidates;

  raise notice
    'Phase P backfill: % invoice posting(s) needed, computed total = %',
    v_invoice_candidate_count, v_computed_invoice_total;

  if v_invoice_candidate_count <> v_expected_invoice_count then
    raise exception
      'Phase P backfill ABORTED: expected exactly % invoice(s) in scope, found %. Refusing to write.',
      v_expected_invoice_count, v_invoice_candidate_count;
  end if;

  -- 8. Because every invoice in scope has balance exactly 0, its total
  -- must exactly equal the sum of its own payments - so the invoice-side
  -- total posted here must exactly equal the payment-side total. This is
  -- guaranteed by construction (balance = total - amount_paid = 0), but
  -- asserted explicitly before writing rather than assumed.
  if v_computed_invoice_total <> v_computed_payment_total then
    raise exception
      'Phase P backfill ABORTED: invoice-side total (%) does not equal payment-side total (%) - for a balance-exactly-0 invoice these must match exactly, or AR would move. Refusing to write.',
      v_computed_invoice_total, v_computed_payment_total;
  end if;

  -- 9. Post the Invoice-type transactions first (Debit AR / Credit
  -- Treatment Revenue) - each of these 13 invoices has no existing
  -- posting, so this is its one and only Invoice-type transaction, for
  -- its full total, exactly like a normal invoice would have received.
  for ri in select * from _phase_p_invoice_candidates order by created_at loop
    v_transaction_id := public._post_ledger_transaction(
      v_clinic_id, ri.created_at::date, 'Invoice', 'invoice', ri.invoice_id,
      'Invoice ' || ri.invoice_number, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ar_account_id, 'debit', ri.total, 'credit', 0),
        jsonb_build_object('account_id', v_revenue_account_id, 'debit', 0, 'credit', ri.total)
      ),
      ri.patient_id, null, null, null
    );

    raise notice
      'Phase P backfill: posted invoice % (%) - AR debit % / Treatment Revenue credit %',
      ri.invoice_number, ri.invoice_id, ri.total, ri.total;
  end loop;

  -- 10. Post the Payment-type transactions (Debit Cash / Credit AR).
  for r in select * from _phase_p_payment_candidates order by received_at loop
    v_transaction_id := public._post_ledger_transaction(
      v_clinic_id, r.received_at::date, 'Payment', 'payment', r.payment_id,
      'Payment received via ' || r.payment_method, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', r.cash_account_id, 'debit', r.amount, 'credit', 0),
        jsonb_build_object('account_id', v_ar_account_id, 'debit', 0, 'credit', r.amount)
      ),
      r.patient_id, null, null, null
    );

    raise notice
      'Phase P backfill: posted payment % (invoice_id %) - Cash debit % / AR credit % via %',
      r.payment_id, r.invoice_id, r.amount, r.amount, r.payment_method;
  end loop;

  -- 11. AR safety guard: recompute both figures independently and
  -- require them to be EXACTLY where they started - by construction
  -- (every invoice in scope had balance = 0 and both sides posted
  -- together for the same total), this must hold.
  select coalesce(sum(e.debit) - sum(e.credit), 0)
    into v_ar_after
  from public.clinic_ledger_entries e
  where e.clinic_id = v_clinic_id
    and e.account_id = v_ar_account_id;

  select coalesce(sum(balance), 0)
    into v_outstanding_invoice_ar_after
  from public.clinic_invoices
  where clinic_id = v_clinic_id
    and balance > 0;

  raise notice
    'Phase P backfill: AFTER - Ledger AR = %, Outstanding Invoice AR = %',
    v_ar_after, v_outstanding_invoice_ar_after;

  if v_ar_after <> v_ar_before then
    raise exception
      'Phase P backfill ABORTED: Ledger AR moved (before %, after %) - expected it to be unchanged since every invoice in scope had balance 0 and both sides posted together. Refusing to write.',
      v_ar_before, v_ar_after;
  end if;

  if v_outstanding_invoice_ar_after <> v_outstanding_invoice_ar_before then
    raise exception
      'Phase P backfill ABORTED: Outstanding Invoice AR moved (before %, after %) - this migration never touches clinic_invoices, so this should be impossible. Refusing to write.',
      v_outstanding_invoice_ar_before, v_outstanding_invoice_ar_after;
  end if;

  if v_ar_after <> v_outstanding_invoice_ar_after then
    raise exception
      'Phase P backfill ABORTED: post-backfill Ledger AR (%) does not equal Outstanding Invoice AR (%). Refusing to write.',
      v_ar_after, v_outstanding_invoice_ar_after;
  end if;

  select count(*) into v_new_payment_txn_count
  from public.clinic_ledger_transactions
  where clinic_id = v_clinic_id
    and transaction_type = 'Payment'
    and reference_id in (select payment_id from _phase_p_payment_candidates);

  select count(*) into v_new_invoice_txn_count
  from public.clinic_ledger_transactions
  where clinic_id = v_clinic_id
    and transaction_type = 'Invoice'
    and reference_id in (select invoice_id from _phase_p_invoice_candidates);

  raise notice
    'Phase P backfill COMPLETE: % Payment transaction(s) posted (total %), % Invoice transaction(s) posted (total %). AR unchanged at %. INV-00007/00010/00012/00018 (KES 79,040.00 across 6 payments) intentionally NOT touched by this migration.',
    v_payment_candidate_count, v_computed_payment_total,
    v_invoice_candidate_count, v_computed_invoice_total, v_ar_after;
end $$;
