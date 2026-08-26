-- Phase Q1/Q6/Q7: a single, bounded, DETECT-ONLY diagnostic listing every
-- clinic_invoices row whose stored total/amount_paid/balance/status
-- contradict each other, plus every overpaid (negative-balance) invoice.
-- Powers both the Accounting Health page's "Invoice Consistency" check
-- (Q6) and its "Overpayments" check (Q7) from one query, rather than two
-- separate implementations of the same per-invoice arithmetic.
--
-- Returns ONLY the exception rows (never every invoice) - a clinic with
-- thousands of invoices still gets a fast, bounded result set, matching
-- the same aggregate-RPC pattern as get_outstanding_invoice_balance/
-- get_payment_ledger_reconciliation (0082/0083). `security invoker` (not
-- definer) so RLS on clinic_invoices/patients still independently governs
-- what the calling user can see.
--
-- Never writes anything - no invoice, payment, or ledger row is ever
-- touched by this function. It only reports what it finds.
create or replace function public.get_invoice_consistency_exceptions(p_clinic_id uuid)
returns table (
  invoice_id uuid,
  invoice_number text,
  patient_id uuid,
  patient_name text,
  total numeric,
  amount_paid numeric,
  balance numeric,
  status text,
  issue text
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    inv.id as invoice_id,
    inv.invoice_number,
    inv.patient_id,
    coalesce(p.first_name || ' ' || p.last_name, '—') as patient_name,
    inv.total,
    inv.amount_paid,
    inv.balance,
    inv.status,
    case
      when inv.amount_paid > inv.total + 0.01 then 'amount_paid exceeds invoice total'
      when abs(inv.balance - round(inv.total - inv.amount_paid, 2)) > 0.01
        then 'balance does not equal total minus amount_paid'
      when inv.status = 'Paid' and inv.balance > 0.01 then 'status is Paid but balance is still outstanding'
      when inv.status = 'Unpaid' and abs(inv.balance) <= 0.01
        then 'status is Unpaid but balance is zero'
      when inv.status = 'Partially Paid' and abs(inv.balance) <= 0.01
        then 'status is Partially Paid but balance is zero'
      when inv.balance < -0.01 then 'invoice is overpaid (negative balance)'
    end as issue
  from public.clinic_invoices inv
  left join public.patients p on p.id = inv.patient_id
  where inv.clinic_id = p_clinic_id
    and (
      inv.amount_paid > inv.total + 0.01
      or abs(inv.balance - round(inv.total - inv.amount_paid, 2)) > 0.01
      or (inv.status = 'Paid' and inv.balance > 0.01)
      or (inv.status = 'Unpaid' and abs(inv.balance) <= 0.01)
      or (inv.status = 'Partially Paid' and abs(inv.balance) <= 0.01)
      or inv.balance < -0.01
    );
$$;

grant execute on function public.get_invoice_consistency_exceptions(uuid) to authenticated;
