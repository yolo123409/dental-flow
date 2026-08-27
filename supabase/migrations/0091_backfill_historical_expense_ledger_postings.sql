-- FIN-3.3: one-time historical backfill of missing Expense ledger
-- postings, following the exact same pattern and safety discipline as
-- migration 0081 (Phase N, invoice AR backfill) and 0084 (Phase P,
-- payment backfill) - reusing _post_ledger_transaction(), never inventing
-- a new repair mechanism.
--
-- ROOT CAUSE (same structural cause as Phase N/P): _trigger_post_expense_ledger()
-- (migration 0043) is an AFTER INSERT trigger, so it cannot retroactively
-- post for clinic_expenses rows that already existed before the ledger's
-- account configuration (default_expense_account_id / default_cash_account_id)
-- was fully in place for this clinic. clinic_ledger_reconciliation_issues
-- has zero rows for either expense, ruling out the trigger's own
-- error-handling path - consistent with the trigger never having fired for
-- these rows at all, the same conclusion Phase N/P reached for the
-- invoice/payment side of this same clinic's early history.
--
-- Evidence: the earliest successfully-posted Expense-type ledger
-- transaction for this clinic is dated 2026-08-23 (a same-day "advertising"
-- expense) - nothing before that date ever posted. Both candidates below
-- (expense_date 2026-08-06 and 2026-08-12) predate that first successful
-- posting; both a "Cash"-method expense and a "Cheque"-method expense are
-- affected, ruling out a payment-method-specific cause.
--
-- SCOPE: exactly the two Paid, non-Voided expenses for this one clinic
-- that have no existing Expense-type ledger posting - never a hardcoded ID
-- list, dynamically discovered and hard-guarded below.
--
-- ACCOUNTING STRUCTURE: reproduces _trigger_post_expense_ledger() exactly -
-- Debit account resolved as coalesce(expense category's
-- default_ledger_account_id, clinic's default_expense_account_id), Credit
-- account resolved as coalesce(clinic's payment_method_accounts mapping for
-- this expense's payment_method, clinic's default_cash_account_id) - both
-- candidates' category ("salary", unmapped) correctly falls back to the
-- clinic's default_expense_account_id, exactly as the live trigger would
-- resolve it today. Dated on each expense's own expense_date (never
-- today's date), description taken verbatim from the expense's own
-- description column, and each expense's own supplier_id/created_by
-- carried onto its transaction row - matching the trigger's own posting
-- exactly in every respect, not just the two ledger entry lines.
--
-- WHAT THIS DOES NOT DO: it does not touch clinic_expenses itself (amount,
-- status, dates are read-only inputs), does not touch any other reference
-- type, and does not attempt the separately-scoped, accounting-policy-
-- gated invoice/payment gap for INV-00007/INV-00010/INV-00012/INV-00018
-- (KES 79,040.00 across 6 payments) - Phase P (migration 0084) already
-- explicitly deferred that one for a human decision on how to treat the
-- two genuinely-overpaid invoices' AR divergence, and that decision has
-- not yet been made.
--
-- SAFETY: single atomic DO block. Before any write, independently
-- recomputes the candidate set and refuses to write anything unless the
-- count and total exactly match what this migration's own investigation
-- found (2 expenses, KES 55,000.00) - a drift means live data has changed
-- since this was written, and the migration aborts loudly rather than
-- guessing.
--
-- IDEMPOTENCY: the "NOT EXISTS (an Expense-type posting for this expense)"
-- clause is the entire idempotency guard - a second run finds zero
-- candidates and exits cleanly via RAISE NOTICE without writing anything.

do $$
declare
  v_clinic_id uuid := 'ed2d8fb6-3603-47bd-ac8e-061a324a489d';

  v_default_expense_account_id uuid;
  v_default_cash_account_id uuid;
  v_payment_method_accounts jsonb;
  v_currency text;

  v_expected_total numeric(12, 2) := 55000.00;
  v_expected_count integer := 2;

  v_computed_total numeric(12, 2);
  v_candidate_count integer;

  r record;
begin
  -- 1. Default expense / cash accounts must be configured for this
  -- clinic - if either is missing, the live trigger itself couldn't post
  -- for an unmapped-category, and neither can this backfill.
  select ls.default_expense_account_id, ls.default_cash_account_id, ls.payment_method_accounts
    into v_default_expense_account_id, v_default_cash_account_id, v_payment_method_accounts
  from public.clinic_ledger_settings ls
  where ls.clinic_id = v_clinic_id;

  if v_default_expense_account_id is null or v_default_cash_account_id is null then
    raise exception
      'FIN-3.3 expense backfill ABORTED: Default Expense or Default Cash account is not configured for clinic %. Nothing written.',
      v_clinic_id;
  end if;

  select coalesce(cs.currency, 'KES') into v_currency
  from public.clinic_settings cs
  where cs.clinic_id = v_clinic_id;

  v_currency := coalesce(v_currency, 'KES');

  -- 2. Dynamically (re-)discover candidate expenses and their resolved
  -- debit/credit accounts - reproducing _trigger_post_expense_ledger()'s
  -- own account-resolution logic exactly, never a hardcoded expense list.
  create temp table _fin33_expense_candidates on commit drop as
  select
    e.id as expense_id,
    e.description,
    e.expense_date,
    e.amount,
    e.supplier_id,
    e.created_by,
    coalesce(ec.default_ledger_account_id, v_default_expense_account_id) as debit_account_id,
    coalesce(
      (v_payment_method_accounts ->> e.payment_method)::uuid,
      v_default_cash_account_id
    ) as credit_account_id
  from public.clinic_expenses e
  left join public.clinic_expense_categories ec on ec.id = e.category_id
  where e.clinic_id = v_clinic_id
    and e.amount > 0
    and e.status = 'Paid'
    and not exists (
      select 1
      from public.clinic_ledger_transactions t
      where t.clinic_id = e.clinic_id
        and t.reference_type = 'expense'
        and t.reference_id = e.id
    );

  select count(*), coalesce(sum(amount), 0)
    into v_candidate_count, v_computed_total
  from _fin33_expense_candidates;

  raise notice
    'FIN-3.3 expense backfill: % candidate expense(s) found, computed total = %',
    v_candidate_count, v_computed_total;

  -- 3. Idempotency: a prior run already posted everything in scope.
  if v_candidate_count = 0 then
    raise notice
      'FIN-3.3 expense backfill: no candidates found (already applied, or nothing to backfill) - exiting without writing anything.';
    return;
  end if;

  -- 4. Hard safety guard: refuse to write anything unless live data still
  -- matches this migration's own investigation exactly.
  if v_computed_total <> v_expected_total then
    raise exception
      'FIN-3.3 expense backfill ABORTED: computed total (%) does not match the expected KES %. Live data has drifted since this migration was written - refusing to write.',
      v_computed_total, v_expected_total;
  end if;

  if v_candidate_count <> v_expected_count then
    raise exception
      'FIN-3.3 expense backfill ABORTED: expected exactly % candidate expense(s), found %. Refusing to write.',
      v_expected_count, v_candidate_count;
  end if;

  if exists (
    select 1 from _fin33_expense_candidates
    where debit_account_id is null or credit_account_id is null
  ) then
    raise exception
      'FIN-3.3 expense backfill ABORTED: at least one candidate has no resolvable debit/credit account. Refusing to write.';
  end if;

  -- 5. All safety checks passed - post one balanced, two-legged Expense
  -- transaction per candidate, reproducing exactly the structure
  -- _trigger_post_expense_ledger() uses for a normal expense today.
  for r in select * from _fin33_expense_candidates order by expense_date loop
    perform public._post_ledger_transaction(
      v_clinic_id, r.expense_date, 'Expense', 'expense', r.expense_id,
      r.description, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', r.debit_account_id, 'debit', r.amount, 'credit', 0),
        jsonb_build_object('account_id', r.credit_account_id, 'debit', 0, 'credit', r.amount)
      ),
      null, r.supplier_id, r.created_by, null
    );

    raise notice
      'FIN-3.3 expense backfill: posted expense % (%) - amount %',
      r.description, r.expense_id, r.amount;
  end loop;

  raise notice
    'FIN-3.3 expense backfill COMPLETE: % expense(s) posted, total = %',
    v_candidate_count, v_computed_total;
end $$;
