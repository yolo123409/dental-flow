-- Full-app audit fix H10 (High): get_invoice_balance_totals (migration
-- 0067, live) sums `total` across every invoice with no status filter -
-- void_invoice (0110) zeroes an invoice's own balance but deliberately
-- never touches its historical `total`, so voiding an invoice permanently
-- overstates the Billing Control Center's "Invoiced" stat by that
-- invoice's full amount forever, while the Ledger's Accounts Receivable
-- page correctly nets it out (it's ledger-derived, and the void's
-- reversal correctly zeroes the ledger revenue). Two pages an owner might
-- look at in the same session, permanently disagreeing after any void.
--
-- SIBLING BUG FOUND WHILE FIXING THIS: get_revenue_analytics (also 0067,
-- powers the Dashboard/Analytics revenue widgets) has the identical gap
-- one step further in - its `outstanding_amount` sums `total - amount_paid`
-- for every invoice with `status <> 'Paid'`. A Voided invoice's status is
-- 'Voided' (which is `<> 'Paid'`) and void_invoice only permits voiding
-- while `amount_paid = 0`, so a voided invoice's full original total gets
-- counted as still-outstanding AR forever - the exact same "void doesn't
-- update everywhere it should" class of bug as the main finding, just in
-- a different report. Fixed the same way, in the same migration, rather
-- than leaving it for a second pass now that it's been found.
--
-- Both are `create or replace` over their exact current live signatures -
-- no drop, no grant change needed.

create or replace function public.get_invoice_balance_totals(p_clinic_id uuid)
returns table (total numeric, paid numeric)
language sql
security invoker
set search_path = public
stable
as $$
  select
    coalesce(sum(total), 0) as total,
    coalesce(sum(amount_paid), 0) as paid
  from public.clinic_invoices
  where clinic_id = p_clinic_id
    and status <> 'Voided';
$$;

create or replace function public.get_revenue_analytics(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  total_revenue numeric,
  total_tax numeric,
  outstanding_amount numeric
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    coalesce(sum(total) filter (where status = 'Paid'), 0) as total_revenue,
    coalesce(sum(tax) filter (where status = 'Paid'), 0) as total_tax,
    coalesce(sum(total) filter (where status not in ('Paid', 'Voided')), 0)
      - coalesce(sum(amount_paid) filter (where status not in ('Paid', 'Voided')), 0) as outstanding_amount
  from public.clinic_invoices
  where clinic_id = p_clinic_id
    and (p_start is null or created_at >= p_start)
    and (p_end is null or created_at <= p_end);
$$;
