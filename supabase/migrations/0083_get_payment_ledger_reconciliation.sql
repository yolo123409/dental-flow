-- Phase O2: a lightweight, reusable, DETECT-ONLY diagnostic comparing
-- clinic_payments against their Payment-type clinic_ledger_transactions/
-- clinic_ledger_entries postings.
--
-- BACKGROUND: Phase N's backfill (migration 0081) closed the historical
-- Accounts Receivable ledger gap (missing Invoice-type postings) but
-- explicitly left payment-side ledger postings untouched. Phase O's own
-- live, independently re-discovered audit (not assumed from Phase N's
-- notes) found the actual gap is much larger than the two invoices
-- (INV-00012, INV-00018) Phase N called out by name: 25 of this clinic's
-- 34 historical payments (KES 350,240.00 of KES 504,440.00 total) have
-- no corresponding Payment-type ledger posting at all. This function
-- does not fix that - Phase O's own instructions require the audit to
-- be reported and explicitly approved before any historical payment
-- ledger entries are written. This is the reusable detection primitive
-- for that audit, and for catching any future recurrence.
--
-- Mirrors the same "SUM/aggregate" RPC pattern already established for
-- every other clinic-wide accounting total (get_invoice_balance_totals,
-- get_trial_balance, get_outstanding_invoice_balance - 0067/0058/0082):
-- `language sql`, `security invoker` (never `security definer` - RLS on
-- clinic_payments/clinic_ledger_transactions/clinic_ledger_entries still
-- independently governs what the calling user can see; this function
-- only changes how the totals are aggregated, never who can see them),
-- `stable`, one required p_clinic_id parameter, granted to `authenticated`.
--
-- Categorizes every payment into exactly one of:
--   - posted: exactly one Payment-type transaction referencing it, whose
--     AR-account credit entry equals the payment amount (within 1 cent).
--   - missing: no Payment-type transaction references it at all.
--   - mismatched: exactly one Payment-type transaction references it,
--     but the posted credit amount differs from the payment amount.
--   - duplicate: more than one Payment-type transaction references it.
--
-- Never writes anything - pure aggregate SELECT, matching every other
-- reconciliation primitive in this codebase (getArReconciliationStatus,
-- getAccountsReceivableReport's reconciliation section). A future caller
-- surfaces "matches: false" for investigation; nothing here ever creates
-- a correcting journal entry.
create or replace function public.get_payment_ledger_reconciliation(p_clinic_id uuid)
returns table (
  total_payments bigint,
  posted_payments bigint,
  missing_payments bigint,
  mismatched_payments bigint,
  duplicate_payments bigint,
  total_payment_amount numeric,
  posted_payment_amount numeric,
  missing_payment_amount numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  with ar_account as (
    select accounts_receivable_account_id as id
    from public.clinic_ledger_settings
    where clinic_id = p_clinic_id
  ),
  payment_postings as (
    select
      p.id as payment_id,
      p.amount as payment_amount,
      count(distinct t.id) as posting_count,
      coalesce(sum(e.credit), 0) as posted_credit
    from public.clinic_payments p
    left join public.clinic_ledger_transactions t
      on t.clinic_id = p.clinic_id
     and t.reference_type = 'payment'
     and t.reference_id = p.id
    left join public.clinic_ledger_entries e
      on e.transaction_id = t.id
     and e.account_id = (select id from ar_account)
    where p.clinic_id = p_clinic_id
    group by p.id, p.amount
  )
  select
    count(*) as total_payments,
    count(*) filter (
      where posting_count = 1 and abs(posted_credit - payment_amount) <= 0.01
    ) as posted_payments,
    count(*) filter (where posting_count = 0) as missing_payments,
    count(*) filter (
      where posting_count = 1 and abs(posted_credit - payment_amount) > 0.01
    ) as mismatched_payments,
    count(*) filter (where posting_count > 1) as duplicate_payments,
    coalesce(sum(payment_amount), 0) as total_payment_amount,
    coalesce(
      sum(payment_amount) filter (
        where posting_count = 1 and abs(posted_credit - payment_amount) <= 0.01
      ),
      0
    ) as posted_payment_amount,
    coalesce(sum(payment_amount) filter (where posting_count = 0), 0) as missing_payment_amount
  from payment_postings;
$$;

grant execute on function public.get_payment_ledger_reconciliation(uuid) to authenticated;
