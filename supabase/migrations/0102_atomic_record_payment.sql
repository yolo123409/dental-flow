-- FIN-4.8: fixes a real, previously-undetected lost-update race in
-- recordPayment() (services/billing.ts), found by this phase's own
-- concurrency testing (scripts/staging/concurrency-test.mjs, "two users
-- pay the same invoice simultaneously") before being confirmed by
-- reading the code.
--
-- THE BUG: recordPayment() does three separate, non-atomic round trips -
-- SELECT clinic_invoices (read amount_paid/balance/total at time T),
-- INSERT clinic_payments, then UPDATE clinic_invoices SET amount_paid =
-- (T's amount_paid + this payment), balance = (total - new amount_paid).
-- Two concurrent payments against the SAME invoice both read the same T,
-- both insert their own real clinic_payments row (so the money looks
-- recorded), but the UPDATE that finishes last simply OVERWRITES the
-- first - amount_paid ends up reflecting only ONE of the two payments,
-- not both. The clinic_payments rows are correct; clinic_invoices.
-- amount_paid/balance silently disagrees with them. This is a genuine
-- lost-update, not merely an unblocked overpayment - and it was possible
-- with real, honestly-recorded money, not just a double-click.
--
-- THE FIX: `record_payment()`, a SECURITY DEFINER RPC that does the
-- entire read-validate-insert-update sequence in one Postgres function
-- call, using `select ... for update` to take a row lock on the invoice
-- BEFORE reading its balance. A second concurrent caller blocks at that
-- lock until the first caller's transaction commits, then reads the
-- ALREADY-UPDATED balance - so the two payments' effects add instead of
-- one clobbering the other, and a genuine overpayment attempt (amount >
-- the now-current balance) is correctly rejected for the second caller
-- too, closing exactly the race this phase's brief asked to test for.
--
-- Reuses, unchanged: the exact status-derivation logic recordPayment()
-- and apply_customer_credit() already use (Paid when balance <= 0,
-- Partially Paid when something has been paid, else Unpaid); the
-- existing trg_guard_role_payments / trg_guard_role_invoices triggers
-- (migration 0097), which still fire on this function's INSERT/UPDATE
-- exactly as they do for any other caller - auth.uid() reflects the
-- real calling session regardless of SECURITY DEFINER, the same
-- property migration 0100's grant/apply/refund_customer_credit RPCs
-- already rely on; the existing AFTER INSERT ledger-posting trigger on
-- clinic_payments (migration 0043) - untouched, still fires the same way
-- on this function's plain INSERT.
--
-- Does NOT touch clinic_invoices/clinic_payments' shape, RLS, or any
-- other write path. services/billing.ts#recordPayment() is updated
-- (this same phase) to call this RPC instead of doing the three
-- separate client calls - no other caller of recordPayment() changes.

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null,
  p_insurance_provider_id uuid default null
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.clinic_invoices;
  v_role text;
  v_new_amount_paid numeric;
  v_new_balance numeric;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a payment amount greater than zero.';
  end if;

  if p_payment_method = 'Insurance' and p_insurance_provider_id is null then
    raise exception 'Select an insurance provider to record this payment as insurance.';
  end if;

  -- Row lock FIRST, then read - this is the actual fix. Any concurrent
  -- caller targeting the same invoice blocks here until this
  -- transaction commits or rolls back.
  select * into v_invoice from public.clinic_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  v_role := public._caller_role(v_invoice.clinic_id);
  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to record a payment.', coalesce(v_role, 'none');
  end if;

  if p_amount > v_invoice.balance then
    raise exception 'Payment amount exceeds the outstanding balance of %.', v_invoice.balance;
  end if;

  insert into public.clinic_payments (
    clinic_id, invoice_id, patient_id, amount, payment_method,
    insurance_provider_id, reference, notes
  ) values (
    v_invoice.clinic_id, v_invoice.id, v_invoice.patient_id, p_amount, p_payment_method,
    case when p_payment_method = 'Insurance' then p_insurance_provider_id else null end,
    p_reference, p_notes
  );

  v_new_amount_paid := round(v_invoice.amount_paid + p_amount, 2);
  v_new_balance := round(v_invoice.total - v_new_amount_paid, 2);
  v_new_status := case
    when v_new_balance <= 0 then 'Paid'
    when v_new_amount_paid > 0 then 'Partially Paid'
    else 'Unpaid'
  end;

  update public.clinic_invoices
  set amount_paid = v_new_amount_paid, balance = v_new_balance, status = v_new_status
  where id = v_invoice.id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

grant execute on function public.record_payment(uuid, numeric, text, text, text, uuid) to authenticated;
