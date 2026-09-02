-- Critical Safety Closure (Audit II, Critical #4, side effect): a Voided
-- invoice keeps its original `total` for history but always has
-- amount_paid = 0 and balance = 0 zeroed by void_invoice() - that's
-- correct and intentional, but get_invoice_consistency_exceptions (0085)
-- didn't know it, so every voided invoice with a nonzero total was
-- permanently flagged as a critical "balance does not equal total minus
-- amount_paid" data-integrity issue on the Accounting Health page, purely
-- because it doesn't understand that `total` is deliberately stale
-- post-void. This adds a Voided exclusion to the same WHERE clause that
-- already excludes non-issues, same shape as the fix already applied to
-- get_invoice_balance_totals/get_revenue_analytics (migration 0117) for
-- the sibling "voided invoice counted as real" bug class.
--
-- Safe to re-run: create or replace function, same signature.

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
    and inv.status <> 'Voided'
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
