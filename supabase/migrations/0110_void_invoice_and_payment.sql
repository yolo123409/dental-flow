-- Billing audit fix #1: there is no way to undo an invoice or reverse a
-- payment. Customer Credit (0100) only reclassifies an overpayment - it
-- never moves money or changes an invoice's status. Money Out (0028) and
-- supplier payments (0044) already have a proven Void pattern - status +
-- voided_at/voided_by/void_reason, reusing the existing generic
-- reverse_ledger_transaction RPC (0043) rather than a second reversal
-- mechanism. This migration ports that exact pattern to clinic_invoices
-- and clinic_payments, which never got it.
--
-- clinic_invoices.status is unconstrained text - confirmed real values
-- are "Unpaid" | "Partially Paid" | "Paid" (services/billing.ts,
-- 0102_atomic_record_payment.sql). clinic_payments has no status column
-- at all today.
--
-- 0094_payment_invoice_integrity_locks.sql's guard trigger
-- (_trigger_guard_posted_invoice_update) blocks changes to a NAMED list
-- of columns once an invoice has a posted ledger transaction - it does
-- not mention the three new columns added below, so they remain
-- writable after posting with zero change to that trigger (it is a
-- blocklist, not an allowlist). status/amount_paid/balance are already
-- exempt there too.
--
-- clinic_payments has zero UPDATE policy (0094 removed it - RLS
-- default-denies). void_payment writes to it only because this function
-- is security definer, exactly how record_payment (0102) already writes
-- INSERTs to it despite the same lack of a client-facing policy.
--
-- Safe to re-run: add column if not exists, create or replace function.

/* ============================================================ */
/* 1. Void columns                                                */
/* ============================================================ */

alter table public.clinic_invoices
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.clinic_users(id) on delete set null,
  add column if not exists void_reason text;

alter table public.clinic_payments
  add column if not exists status text not null default 'Recorded' check (status in ('Recorded', 'Voided')),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.clinic_users(id) on delete set null,
  add column if not exists void_reason text;

/* ============================================================ */
/* 2. Void an invoice - only while nothing has been paid against  */
/*    it yet (void each payment first, then void the invoice -    */
/*    no ambiguous partial-void state to define). Frees its        */
/*    charges back to Pending so they can be corrected and         */
/*    re-invoiced, the exact inverse of create_invoice_from_       */
/*    charges (0109).                                               */
/* ============================================================ */

create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_reason text default null
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_invoice public.clinic_invoices;
  v_transaction_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to void an invoice.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can void an invoice';
  end if;

  select * into v_invoice from public.clinic_invoices i
  where i.id = p_invoice_id and i.clinic_id = v_clinic_id
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found for this clinic';
  end if;

  if v_invoice.status = 'Voided' then
    raise exception 'This invoice has already been voided';
  end if;

  if v_invoice.amount_paid > 0 then
    raise exception 'This invoice has % paid against it - void each payment first, then void the invoice.', v_invoice.amount_paid;
  end if;

  select t.id into v_transaction_id from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.reference_type = 'invoice' and t.reference_id = p_invoice_id
    and t.reversed_by is null;

  if v_transaction_id is not null then
    perform public.reverse_ledger_transaction(v_clinic_id, v_transaction_id, coalesce(p_reason, 'Invoice voided'));
  end if;

  update public.clinic_charges
  set status = 'Pending', invoice_id = null
  where invoice_id = p_invoice_id;

  -- balance is zeroed too, not just status flipped to Voided - otherwise
  -- a voided invoice would keep showing up as outstanding/overdue AR
  -- everywhere that filters on balance > 0 (getArSummary,
  -- getAccountsReceivableReport, checkOverdueInvoices).
  update public.clinic_invoices
  set status = 'Voided', balance = 0, voided_at = now(), voided_by = v_clinic_user_id, void_reason = p_reason
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

grant execute on function public.void_invoice(uuid, text) to authenticated;

/* ============================================================ */
/* 3. Void a payment - reverses its ledger entry and backs the    */
/*    invoice's amount_paid/balance/status out by exactly this    */
/*    payment's amount, the mirror image of record_payment's own  */
/*    (0102) status-derivation formula.                            */
/* ============================================================ */

create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text default null
)
returns public.clinic_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_payment public.clinic_payments;
  v_invoice public.clinic_invoices;
  v_transaction_id uuid;
  v_new_amount_paid numeric;
  v_new_balance numeric;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to void a payment.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can void a payment';
  end if;

  select * into v_payment from public.clinic_payments p
  where p.id = p_payment_id and p.clinic_id = v_clinic_id
  for update;

  if v_payment.id is null then
    raise exception 'Payment not found for this clinic';
  end if;

  if v_payment.status = 'Voided' then
    raise exception 'This payment has already been voided';
  end if;

  -- Same lock order as record_payment (0102): invoice locked before its
  -- balance is read, so this can never race a concurrent recordPayment()
  -- (or another void) on the same invoice.
  select * into v_invoice from public.clinic_invoices i
  where i.id = v_payment.invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found for this payment';
  end if;

  select t.id into v_transaction_id from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.reference_type = 'payment' and t.reference_id = p_payment_id
    and t.reversed_by is null;

  if v_transaction_id is not null then
    perform public.reverse_ledger_transaction(v_clinic_id, v_transaction_id, coalesce(p_reason, 'Payment voided'));
  end if;

  update public.clinic_payments
  set status = 'Voided', voided_at = now(), voided_by = v_clinic_user_id, void_reason = p_reason
  where id = p_payment_id
  returning * into v_payment;

  v_new_amount_paid := round(v_invoice.amount_paid - v_payment.amount, 2);
  v_new_balance := round(v_invoice.total - v_new_amount_paid, 2);
  v_new_status := case
    when v_invoice.status = 'Voided' then 'Voided'
    when v_new_balance <= 0 and v_new_amount_paid > 0 then 'Paid'
    when v_new_amount_paid > 0 then 'Partially Paid'
    else 'Unpaid'
  end;

  update public.clinic_invoices
  set amount_paid = v_new_amount_paid, balance = v_new_balance, status = v_new_status
  where id = v_invoice.id;

  return v_payment;
end;
$$;

grant execute on function public.void_payment(uuid, text) to authenticated;
