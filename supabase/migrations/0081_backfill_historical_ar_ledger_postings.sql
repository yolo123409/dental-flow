-- Phase N: one-time historical backfill of missing Accounts Receivable
-- ledger postings, closing the exact discrepancy Phase M (read-only
-- forensic investigation) proved and Phase N explicitly approved.
--
-- ROOT CAUSE (Phase M): _trigger_post_invoice_ledger() and
-- _trigger_post_payment_ledger() (migration 0043) are AFTER INSERT
-- triggers - correct for all ongoing activity, but structurally unable to
-- retroactively post for clinic_invoices/clinic_payments rows that
-- already existed before the ledger trigger infrastructure went live for
-- this clinic. Migration 0043 was never paired with a one-time backfill
-- for pre-existing data. Every AR ledger entry for the affected clinic
-- has a transaction_date of 2026-08-16 or later; invoices exist back to
-- 2026-07-20. clinic_ledger_reconciliation_issues has zero rows for this
-- clinic, ruling out the trigger's own error-handling path - the trigger
-- simply never fired for these rows, because it (or the account mapping
-- it depends on) did not exist yet when they were inserted.
--
-- SCOPE: This migration touches exactly ONE clinic - the one Phase M
-- investigated - not every clinic in this database. Other clinics may
-- have entirely unrelated data and are deliberately left untouched.
--
-- WHAT THIS DOES NOT DO (by design, per Phase N's explicit instructions):
--   - It does NOT touch clinic_invoices, clinic_payments, or any other
--     financial source table. Invoice totals, balances, payment amounts,
--     and patient balances are read-only inputs here, never written.
--   - It does NOT create any Payment-type ledger transaction. Two
--     payments already have valid Payment-type postings without their
--     invoice's own debit (INV-00008's KES 500 + KES 300, and INV-00004's
--     KES 6,666 + KES 13,334) - those existing postings are left exactly
--     as they are. Two OTHER historical payments (against INV-00012 and
--     INV-00018, totaling KES 10,040) were themselves never posted -
--     backfilling THEM is out of scope for this phase, so this migration
--     does not attempt to reconstruct that missing payment-side history.
--   - It does NOT attempt to backfill every historically-unposted
--     invoice. Roughly 17 additional historical invoices exist that are
--     now fully Paid with NEITHER their invoice-debit NOR their
--     payment-credit ever posted - since neither side exists, they
--     already net to zero effect on any balance, so backfilling them
--     would add ledger noise without closing any real gap. They are
--     deliberately excluded by this migration's own candidate query
--     (see below).
--
-- WHICH INVOICES QUALIFY (computed live below, never hardcoded): an
-- invoice belongs to the target clinic, has a positive total, has NO
-- existing Invoice-type AR posting, AND either (a) is still outstanding
-- (balance > 0), or (b) already has at least one posted Payment-type AR
-- credit with no offsetting debit (an orphaned credit that would
-- otherwise permanently understate the ledger's AR balance). Condition
-- (b) is what correctly pulls in INV-00004 (fully paid, balance = 0) and
-- excludes the ~17 "both sides missing" invoices described above.
--
-- BACKFILL AMOUNT (per invoice, never a blind "invoice.total"): for each
-- qualifying invoice, the amount posted is
--     invoice.balance + (sum of that invoice's ALREADY-POSTED payment
--     credits)
-- This is the amount that makes THIS invoice's ledger contribution
-- (new debit - existing credits) equal exactly its real current balance -
-- for 11 of the 13 qualifying invoices this equals invoice.total (no
-- prior activity to account for); for INV-00008 and INV-00004 it also
-- equals invoice.total (their existing posted credits plus the current
-- balance sum back to the full total); for INV-00012 and INV-00018 it is
-- LESS than invoice.total by exactly KES 40 and KES 10,000 respectively -
-- the size of their still-unposted historical payments described above.
-- This is a deliberate, minimal choice: it closes the AR gap exactly
-- without fabricating a debit that a real, un-backfilled payment credit
-- would then leave permanently unreconciled in the other direction.
--
-- Each backfilled invoice gets a full, BALANCED, two-legged transaction
-- (debit Accounts Receivable, credit Treatment Revenue - the exact same
-- structure _trigger_post_invoice_ledger() uses today, reproduced here
-- rather than reinvented), dated the invoice's own creation date (never
-- today's date), with the same "Invoice <number>" description format
-- every other Invoice-type transaction already uses. Posting both legs
-- with the SAME amount keeps Treatment Revenue's growth mathematically
-- tied to AR's growth, preserving Phase M's already-passing "P&L Revenue
-- = AR Invoiced" reconciliation check rather than introducing a new one.
--
-- SAFETY: everything below runs inside one DO block, which Postgres
-- already executes as a single atomic unit - any RAISE EXCEPTION rolls
-- back every insert this block has made so far, so there is no path to a
-- partially-backfilled ledger. Before any write, the block independently
-- recomputes the candidate set and its total dollar amount and REFUSES TO
-- WRITE ANYTHING unless that total is exactly the KES 541,160.00 Phase M
-- proved and the candidate count is exactly 13 - if live data has drifted
-- from Phase M's findings since this migration was written, it aborts
-- loudly instead of silently posting a different amount.
--
-- IDEMPOTENCY: the candidate query's own "NOT EXISTS (an Invoice-type
-- posting for this invoice)" clause is the entire idempotency guard -
-- running this migration a second time finds zero candidates (every
-- qualifying invoice now already has its posting) and exits cleanly via
-- RAISE NOTICE without inserting anything.
--
-- No RLS policy is touched. This DO block runs with the privileges of
-- whichever role applies the migration (the same as every other
-- migration in this project) - not a new SECURITY DEFINER function, and
-- it grants no new runtime access to any application role.

do $$
declare
  -- The one clinic Phase M's investigation concerns - not a blind
  -- assumption, but re-verified against live data below before any
  -- write (account configuration, account code, candidate count, and
  -- total amount are all independently recomputed, never trusted from
  -- this comment alone).
  v_clinic_id uuid := 'ed2d8fb6-3603-47bd-ac8e-061a324a489d';

  v_ar_account_id uuid;
  v_ar_account_code text;
  v_revenue_account_id uuid;
  v_currency text;

  v_expected_total numeric(12, 2) := 541160.00;
  v_expected_count integer := 13;

  v_computed_total numeric(12, 2);
  v_candidate_count integer;

  r record;
  v_transaction_id uuid;
begin
  -- 1. Accounts Receivable / Treatment Revenue must be configured for
  -- this clinic - if either is missing, the existing invoice trigger
  -- itself couldn't post either, and neither can this backfill.
  select ls.accounts_receivable_account_id, ls.treatment_revenue_account_id
    into v_ar_account_id, v_revenue_account_id
  from public.clinic_ledger_settings ls
  where ls.clinic_id = v_clinic_id;

  if v_ar_account_id is null or v_revenue_account_id is null then
    raise exception
      'Phase N backfill ABORTED: Accounts Receivable or Treatment Revenue account is not configured for clinic %. Nothing written.',
      v_clinic_id;
  end if;

  -- 2. The AR account must be the one Phase M actually investigated
  -- (code 1100) - a stale/reconfigured mapping must not silently redirect
  -- this backfill at a different account.
  select code into v_ar_account_code
  from public.clinic_ledger_accounts
  where id = v_ar_account_id;

  if v_ar_account_code is distinct from '1100' then
    raise exception
      'Phase N backfill ABORTED: expected the Accounts Receivable account code to be 1100, found %. Nothing written.',
      v_ar_account_code;
  end if;

  select coalesce(cs.currency, 'KES') into v_currency
  from public.clinic_settings cs
  where cs.clinic_id = v_clinic_id;

  v_currency := coalesce(v_currency, 'KES');

  -- 3. Dynamically (re-)discover the candidate invoices and their exact
  -- backfill amounts - never a hardcoded invoice-ID list. See the header
  -- comment above for the exact qualification and amount logic.
  create temp table _phase_n_backfill_candidates on commit drop as
  select
    i.id as invoice_id,
    i.invoice_number,
    i.created_at,
    i.patient_id,
    i.balance,
    i.total,
    coalesce(pc.posted_credits, 0)::numeric(12, 2) as posted_credits,
    (i.balance + coalesce(pc.posted_credits, 0))::numeric(12, 2) as backfill_amount
  from public.clinic_invoices i
  left join lateral (
    select sum(e.credit) as posted_credits
    from public.clinic_payments p
    join public.clinic_ledger_transactions t
      on t.clinic_id = p.clinic_id
     and t.reference_type = 'payment'
     and t.reference_id = p.id
    join public.clinic_ledger_entries e
      on e.transaction_id = t.id
     and e.account_id = v_ar_account_id
    where p.invoice_id = i.id
  ) pc on true
  where i.clinic_id = v_clinic_id
    and i.total > 0
    and not exists (
      select 1
      from public.clinic_ledger_transactions t2
      where t2.clinic_id = i.clinic_id
        and t2.reference_type = 'invoice'
        and t2.reference_id = i.id
    )
    and (i.balance > 0 or coalesce(pc.posted_credits, 0) > 0);

  select count(*), coalesce(sum(backfill_amount), 0)
    into v_candidate_count, v_computed_total
  from _phase_n_backfill_candidates;

  raise notice
    'Phase N backfill: % candidate invoice(s) found, computed total = %',
    v_candidate_count, v_computed_total;

  -- 4. Idempotency: if a prior run of this exact migration already
  -- posted everything, the candidate set is now empty - exit cleanly,
  -- write nothing, do not treat this as an error.
  if v_candidate_count = 0 then
    raise notice
      'Phase N backfill: no candidates found (already applied, or nothing to backfill) - exiting without writing anything.';
    return;
  end if;

  -- 5. Hard safety guard: refuse to write anything unless the live data
  -- still matches Phase M's proven findings exactly. A drift here means
  -- the world has changed since the investigation and this migration
  -- must not guess.
  if v_computed_total <> v_expected_total then
    raise exception
      'Phase N backfill ABORTED: computed backfill total (%) does not match the KES % Phase M proved. Live data has drifted since the investigation - refusing to write. Re-investigate before re-running.',
      v_computed_total, v_expected_total;
  end if;

  if v_candidate_count <> v_expected_count then
    raise exception
      'Phase N backfill ABORTED: expected exactly % candidate invoice(s) (12 outstanding + INV-00004), found %. Refusing to write.',
      v_expected_count, v_candidate_count;
  end if;

  -- 6. Every backfill_amount must be strictly positive - clinic_ledger_entries
  -- itself enforces "debit > 0 or credit > 0" per row; checking here first
  -- produces a clear, actionable error instead of a raw constraint violation.
  if exists (select 1 from _phase_n_backfill_candidates where backfill_amount <= 0) then
    raise exception
      'Phase N backfill ABORTED: at least one candidate has a non-positive backfill amount, which cannot be posted. Refusing to write.';
  end if;

  -- 7. All safety checks passed - post one balanced, two-legged Invoice
  -- transaction per candidate, reproducing exactly the structure
  -- _trigger_post_invoice_ledger() uses for a normal invoice today.
  for r in select * from _phase_n_backfill_candidates order by created_at loop
    insert into public.clinic_ledger_transactions (
      clinic_id, transaction_date, transaction_type, reference_type, reference_id,
      description, currency, patient_id
    ) values (
      v_clinic_id, r.created_at::date, 'Invoice', 'invoice', r.invoice_id,
      'Invoice ' || r.invoice_number, v_currency, r.patient_id
    )
    returning id into v_transaction_id;

    insert into public.clinic_ledger_entries (clinic_id, transaction_id, account_id, debit, credit)
    values (v_clinic_id, v_transaction_id, v_ar_account_id, r.backfill_amount, 0);

    insert into public.clinic_ledger_entries (clinic_id, transaction_id, account_id, debit, credit)
    values (v_clinic_id, v_transaction_id, v_revenue_account_id, 0, r.backfill_amount);

    raise notice
      'Phase N backfill: posted invoice % (%) - AR debit % / Treatment Revenue credit %',
      r.invoice_number, r.invoice_id, r.backfill_amount, r.backfill_amount;
  end loop;

  raise notice
    'Phase N backfill COMPLETE: % invoice(s) posted, total AR debit added = %',
    v_candidate_count, v_computed_total;
end $$;
