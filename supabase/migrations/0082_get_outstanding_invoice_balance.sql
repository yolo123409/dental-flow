-- Phase O1: a single authoritative "Outstanding AR" aggregate.
--
-- BACKGROUND: Phase N's live validation found the Billing page header
-- ("Outstanding" stat card, services/billing.ts#getInvoiceBalanceTotals,
-- backed by the get_invoice_balance_totals RPC from migration 0067)
-- disagreeing with the canonical Accounts Receivable figure used
-- everywhere else (getArSummary, getAccountsReceivableReport, the AR
-- ledger reconciliation, Financial Overview) by KES 1,003.48.
--
-- ROOT CAUSE (Phase O audit): get_invoice_balance_totals computes
-- SUM(total) - SUM(amount_paid) across EVERY invoice, which is
-- mathematically the same as SUM(balance) across every invoice - a
-- fully-paid invoice contributes 0, but an OVERPAID invoice contributes
-- a NEGATIVE balance that nets against (reduces) every other invoice's
-- positive balance. Two already-Paid invoices in this clinic's history
-- (INV-00007, INV-00010) are overpaid by a combined KES 1,003.48 -
-- get_invoice_balance_totals silently subtracts that overpayment from
-- the clinic-wide outstanding total, even though the two facts are
-- unrelated: nobody owes any less on the other 22 outstanding invoices
-- just because two different, already-settled invoices were overpaid.
--
-- This app has no formal credit-balance/refund concept anywhere in its
-- schema (migration 0043's own comment: "No refund concept exists
-- anywhere... not implemented since there is nothing real to post") -
-- an overpayment is not money owed back or available to apply
-- elsewhere, it is simply an invoice whose balance happens to be
-- negative. "Outstanding AR" - what a clinic is currently owed - should
-- never be reduced by that.
--
-- Every OTHER existing "Outstanding" calculation in this codebase
-- already gets this right, just via three independent implementations
-- that happen to agree:
--   - getArSummary() (services/billing.ts): fetches every invoice
--     WHERE balance > 0 and sums balance client-side.
--   - getAccountsReceivableReport()'s reconciliation.invoiceOutstandingBalance
--     (services/accountsReceivable.ts): same balance > 0 filter.
--   - generateOutstandingBalancesReport() (services/reports/outstandingBalances.ts):
--     filters WHERE status <> 'Paid' instead of balance > 0, which is
--     equivalent today only because recordPayment() (the sole writer of
--     both columns) always keeps them in lockstep - a coincidence of
--     implementation, not a shared source of truth.
--
-- This function gives every caller that only needs the single total (not
-- per-invoice detail) one server-side aggregate to call instead of
-- re-deriving it, so a future change to the definition only has to
-- happen once. It does not replace getArSummary() or
-- getAccountsReceivableReport(), which still need the full per-invoice
-- row set for aging/detail anyway and already compute the same number
-- correctly from rows they fetch for other reasons.
--
-- Deliberately NOT floored via GREATEST(balance, 0) summed over every
-- row (which would also work) but expressed as SUM(balance) WHERE
-- balance > 0, for clarity and to match getArSummary()'s existing filter
-- exactly - both are algebraically identical.
--
-- get_invoice_balance_totals (migration 0067) is NOT changed or removed
-- by this migration - its `total`/`paid` fields (Invoiced/Paid stat
-- cards) are still correct and still needed; only its `.outstanding`
-- field is being replaced at its call sites, in application code, not here.
create or replace function public.get_outstanding_invoice_balance(p_clinic_id uuid)
returns table (outstanding numeric)
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(sum(balance), 0) as outstanding
  from public.clinic_invoices
  where clinic_id = p_clinic_id
    and balance > 0;
$$;

grant execute on function public.get_outstanding_invoice_balance(uuid) to authenticated;
