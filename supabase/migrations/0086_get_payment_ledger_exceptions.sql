-- Phase Q1/Q4/Q5: per-payment detail behind get_payment_ledger_reconciliation's
-- (migration 0083) aggregate counts - returns ONLY the payments that are
-- missing, mismatched, or duplicate-posted, each tagged with its invoice
-- number so the Accounting Health service can tell a KNOWN historical
-- exception (e.g. INV-00007's payments, left unposted by Phase P's own
-- explicit, user-approved scope decision) apart from a NEW/unexpected
-- discrepancy on an invoice nobody has ever reviewed before.
--
-- Deliberately not folded into get_payment_ledger_reconciliation itself:
-- that function intentionally stays a pure aggregate (cheap to call
-- anywhere just for the counts); this one does the same underlying
-- classification but returns row detail, so it's only ever needed by a
-- caller that must identify WHICH payments are exceptions, not merely
-- how many. Still bounded and cheap - it returns only the exception rows,
-- never the clinic's full payment history.
--
-- `security invoker` (not definer): RLS on clinic_payments/
-- clinic_ledger_transactions/clinic_ledger_entries/clinic_invoices still
-- independently governs what the calling user can see. Never writes
-- anything.
create or replace function public.get_payment_ledger_exceptions(p_clinic_id uuid)
returns table (
  payment_id uuid,
  invoice_id uuid,
  invoice_number text,
  patient_id uuid,
  payment_amount numeric,
  posting_count bigint,
  posted_credit numeric,
  exception_type text
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
      pay.id as payment_id,
      pay.invoice_id,
      pay.patient_id,
      pay.amount as payment_amount,
      count(distinct t.id) as posting_count,
      coalesce(sum(e.credit), 0) as posted_credit
    from public.clinic_payments pay
    left join public.clinic_ledger_transactions t
      on t.clinic_id = pay.clinic_id
     and t.reference_type = 'payment'
     and t.reference_id = pay.id
    left join public.clinic_ledger_entries e
      on e.transaction_id = t.id
     and e.account_id = (select id from ar_account)
    where pay.clinic_id = p_clinic_id
    group by pay.id, pay.invoice_id, pay.patient_id, pay.amount
  )
  select
    pp.payment_id,
    pp.invoice_id,
    inv.invoice_number,
    pp.patient_id,
    pp.payment_amount,
    pp.posting_count,
    pp.posted_credit,
    case
      when pp.posting_count = 0 then 'missing'
      when pp.posting_count > 1 then 'duplicate'
      else 'mismatched'
    end as exception_type
  from payment_postings pp
  join public.clinic_invoices inv on inv.id = pp.invoice_id
  where pp.posting_count = 0
     or pp.posting_count > 1
     or abs(pp.posted_credit - pp.payment_amount) > 0.01;
$$;

grant execute on function public.get_payment_ledger_exceptions(uuid) to authenticated;
