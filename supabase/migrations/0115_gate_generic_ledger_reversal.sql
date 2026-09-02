-- Full-app audit fix C2 (Critical) + H8 (High) + a bonus regression fix
-- found while researching this one.
--
-- C2: reverse_ledger_transaction (migration 0062, live) has no allowlist
-- by transaction_type. The Ledger's generic "Reverse Transaction" button
-- (app/admin/ledger/[id]/page.tsx) offers it identically for every
-- transaction type, including Invoice and Payment - reversing either one
-- flips the ledger's AR/Revenue/Cash entries but never touches
-- clinic_invoices.status/balance/amount_paid or clinic_payments.status,
-- none of which is what void_invoice/void_payment (migration 0110) -
-- built specifically to replace this for those two types - actually do.
-- The result is a silent, permanent split between the ledger and every
-- billing page, with no way back.
--
-- H8: the same generic path is the only theoretically-available "undo"
-- for a mistakenly-applied Customer Credit today, and using it makes
-- things WORSE (fixes the ledger, leaves clinic_customer_credits and the
-- wrongly-credited invoice's balance exactly as wrong as before) rather
-- than fixing the actual mistake. There is no dedicated undo RPC for this
-- at all currently.
--
-- THE FIX: split reverse_ledger_transaction into a not-client-callable
-- core (all the existing logic, unchanged) and a thin public gate that
-- refuses to reverse an 'invoice'/'payment'/'customer_credit'-referencing
-- transaction and points the caller at the correct dedicated tool
-- instead. void_invoice/void_payment call the core directly (they ARE
-- the correct dedicated tool for their two types). A new
-- reverse_customer_credit_application RPC becomes the dedicated tool for
-- credit applications - see its own header comment below for why it
-- posts a fresh mirror-image transaction rather than trying to reverse a
-- specific historical one (customer-credit ledger postings are not
-- uniquely addressable by reference_id the way invoice/payment postings
-- are - a single credit's reference_id repeats across every invoice it's
-- ever applied to).
--
-- BONUS REGRESSION FIX: void_invoice/void_payment (0110, written AFTER
-- 0062) resolve their own v_clinic_id via
-- `select ... from clinic_users where auth_user_id = v_uid limit 1` - the
-- exact "arbitrary branch pick" bug 0062 was written to eliminate
-- elsewhere. For a multi-branch CEO (multiple clinic_users rows), this
-- can arbitrarily pick a DIFFERENT branch than the one the target
-- invoice/payment actually belongs to, making the subsequent
-- `where i.id = p_invoice_id and i.clinic_id = v_clinic_id` correctly
-- fail to find it ("Invoice not found for this clinic") for no reason a
-- CEO could understand. Fixed by deriving v_clinic_id from the target
-- row itself first, then resolving role against THAT clinic_id - the
-- exact pattern create_invoice_from_charges already uses correctly.
--
-- Safe to re-run: create or replace functions throughout, one new
-- function with a fresh grant, one constraint drop+recreate (idempotent -
-- re-running drops and re-adds the identical widened constraint).

/* ============================================================ */
/* 0. Widen the ledger's transaction_type vocabulary for the new  */
/*    reversal type reverse_customer_credit_application posts.    */
/* ============================================================ */

alter table public.clinic_ledger_transactions
  drop constraint if exists clinic_ledger_transactions_transaction_type_check;

alter table public.clinic_ledger_transactions
  add constraint clinic_ledger_transactions_transaction_type_check
  check (transaction_type in (
    'Invoice', 'Payment', 'Expense', 'InventoryReceipt', 'InventoryConsumption',
    'InventoryReturn', 'ManualJournal', 'Reversal', 'OpeningBalance',
    'CustomerCreditGrant', 'CustomerCreditApplication', 'CustomerCreditRefund',
    'CustomerCreditApplicationReversal'
  ));

/* ============================================================ */
/* 1. Not-client-callable core - identical logic to the current   */
/*    live reverse_ledger_transaction (migration 0062), just       */
/*    renamed and never granted to authenticated.                  */
/* ============================================================ */

create or replace function public._reverse_ledger_transaction_core(
  p_clinic_id uuid,
  p_transaction_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original record;
  v_entries jsonb;
  v_new_id uuid;
begin
  select * into v_original from public.clinic_ledger_transactions t
  where t.id = p_transaction_id and t.clinic_id = p_clinic_id;

  if v_original.id is null then
    raise exception 'Transaction not found for this clinic';
  end if;

  if v_original.reversed_by is not null then
    raise exception 'This transaction has already been reversed';
  end if;

  if v_original.transaction_type = 'Reversal' then
    raise exception 'A reversal transaction cannot itself be reversed';
  end if;

  v_entries := public._build_reversal_entries(p_transaction_id);

  v_new_id := public._post_ledger_transaction(
    p_clinic_id, current_date, 'Reversal', 'reversal', v_original.id,
    'Reversal of: ' || v_original.description
      || case when p_notes is not null and trim(p_notes) <> '' then ' - ' || trim(p_notes) else '' end,
    v_original.currency, v_entries,
    v_original.patient_id, v_original.supplier_id, null, v_original.id
  );

  update public.clinic_ledger_transactions set reversed_by = v_new_id where id = v_original.id;

  return v_new_id;
end;
$$;

revoke all on function public._reverse_ledger_transaction_core(uuid, uuid, text) from public;

/* ============================================================ */
/* 2. Public reverse_ledger_transaction becomes a thin gate: same */
/*    auth/role check as before, then refuse the three types that */
/*    have (or now have) a dedicated, correct undo tool.           */
/* ============================================================ */

create or replace function public.reverse_ledger_transaction(
  p_clinic_id uuid,
  p_transaction_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_reference_type text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role into v_clinic_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can reverse ledger transactions';
  end if;

  select reference_type into v_reference_type
  from public.clinic_ledger_transactions
  where id = p_transaction_id and clinic_id = v_clinic_id;

  if v_reference_type is null then
    raise exception 'Transaction not found for this clinic';
  end if;

  if v_reference_type = 'invoice' then
    raise exception 'Use Void Invoice on the invoice itself to reverse this transaction - it also frees the charges and updates the invoice''s own status, which a plain ledger reversal cannot do.';
  end if;

  if v_reference_type = 'payment' then
    raise exception 'Use Void Payment on the payment itself to reverse this transaction - it also updates the invoice''s balance and status, which a plain ledger reversal cannot do.';
  end if;

  if v_reference_type = 'customer_credit' then
    raise exception 'Use the customer credit''s own Reverse action to undo this - a plain ledger reversal would leave the credit''s remaining balance and the invoice it was applied to unchanged, making the mismatch worse.';
  end if;

  return public._reverse_ledger_transaction_core(v_clinic_id, p_transaction_id, p_notes);
end;
$$;

grant execute on function public.reverse_ledger_transaction(uuid, uuid, text) to authenticated;

/* ============================================================ */
/* 3. void_invoice / void_payment: call the core directly (they   */
/*    are the correct dedicated tool for 'invoice'/'payment'), and */
/*    fix the arbitrary-clinic-pick regression while in here.      */
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

  -- Derive the clinic from the invoice itself, not an arbitrary pick
  -- across the caller's clinic_users rows - fixes a regression that
  -- reintroduced the exact "arbitrary branch pick" bug migration 0062
  -- eliminated everywhere else. A multi-branch CEO voiding an invoice in
  -- Branch B must resolve Branch B here, not whichever branch happened to
  -- come back first.
  select clinic_id into v_clinic_id from public.clinic_invoices where id = p_invoice_id;

  if v_clinic_id is null then
    raise exception 'Invoice not found';
  end if;

  select cu.role, cu.id into v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin') then
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
    perform public._reverse_ledger_transaction_core(v_clinic_id, v_transaction_id, coalesce(p_reason, 'Invoice voided'));
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

  -- Same clinic-derivation fix as void_invoice above.
  select clinic_id into v_clinic_id from public.clinic_payments where id = p_payment_id;

  if v_clinic_id is null then
    raise exception 'Payment not found';
  end if;

  select cu.role, cu.id into v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin') then
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
    perform public._reverse_ledger_transaction_core(v_clinic_id, v_transaction_id, coalesce(p_reason, 'Payment voided'));
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

/* ============================================================ */
/* 4. reverse_customer_credit_application - the dedicated tool    */
/*    for H8. Posts a fresh mirror-image ledger transaction        */
/*    rather than trying to locate and flag one specific historical*/
/*    transaction as reversed: unlike an invoice or payment,       */
/*    apply_customer_credit's postings are not uniquely addressable*/
/*    by reference_id (reference_type='customer_credit',           */
/*    reference_id=credit.id repeats across every invoice the same */
/*    credit has ever been applied to) - so the caller identifies   */
/*    the specific application to undo the same way they identify  */
/*    it to CREATE one: by credit + invoice + amount.               */
/* ============================================================ */

create or replace function public.reverse_customer_credit_application(
  p_credit_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text default null
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_credit public.clinic_customer_credits;
  v_invoice public.clinic_invoices;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_new_amount_paid numeric;
  v_new_balance numeric;
  v_new_status text;
  v_total_ever_applied numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than 0.';
  end if;

  select * into v_credit from public.clinic_customer_credits where id = p_credit_id for update;
  if not found then
    raise exception 'Customer credit not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id;

  if v_role is null or v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can reverse a customer credit application';
  end if;

  select * into v_invoice from public.clinic_invoices i
  where i.id = p_invoice_id and i.clinic_id = v_credit.clinic_id
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found in this clinic';
  end if;

  if v_invoice.patient_id != v_credit.patient_id then
    raise exception 'This credit belongs to a different patient than the target invoice.';
  end if;

  -- Sanity bounds: this can't perfectly re-verify one SPECIFIC prior
  -- application (nothing durably records each one individually - see
  -- header comment), but it can refuse anything that isn't even
  -- possible: the amount being reversed can never exceed what this
  -- credit has ever given out in total, nor what this invoice has ever
  -- had paid against it.
  v_total_ever_applied := round(v_credit.amount - v_credit.remaining_amount, 2);

  if p_amount > v_total_ever_applied then
    raise exception 'Amount (%) exceeds the total (%) ever applied from this credit.', p_amount, v_total_ever_applied;
  end if;

  if p_amount > v_invoice.amount_paid then
    raise exception 'Amount (%) exceeds invoice %''s amount paid (%).', p_amount, v_invoice.invoice_number, v_invoice.amount_paid;
  end if;

  if v_credit.remaining_amount + p_amount > v_credit.amount then
    raise exception 'Reversing % would make this credit''s remaining balance exceed its original amount (%).', p_amount, v_credit.amount;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_credit.clinic_id;
  if v_settings.accounts_receivable_account_id is null or v_settings.customer_credit_account_id is null then
    raise exception 'Accounts Receivable or Customer Credits account is not configured for this clinic.';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_credit.clinic_id;

  update public.clinic_customer_credits
  set remaining_amount = remaining_amount + p_amount, updated_at = now()
  where id = v_credit.id;

  v_new_amount_paid := round(v_invoice.amount_paid - p_amount, 2);
  v_new_balance := round(v_invoice.total - v_new_amount_paid, 2);
  v_new_status := case
    when v_invoice.status = 'Voided' then 'Voided'
    when v_new_balance <= 0 and v_new_amount_paid > 0 then 'Paid'
    when v_new_amount_paid > 0 then 'Partially Paid'
    else 'Unpaid'
  end;

  update public.clinic_invoices
  set amount_paid = v_new_amount_paid, balance = v_new_balance, status = v_new_status
  where id = v_invoice.id
  returning * into v_invoice;

  -- Mirror image of apply_customer_credit's own posting (debit/credit
  -- flipped) - a fresh transaction, not a flag on the original, for the
  -- structural reason in this function's header comment.
  perform public._post_ledger_transaction(
    v_credit.clinic_id, current_date, 'CustomerCreditApplicationReversal', 'customer_credit', v_credit.id,
    'Reversal of customer credit applied to ' || v_invoice.invoice_number
      || case when p_reason is not null and trim(p_reason) <> '' then ' - ' || trim(p_reason) else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', 0, 'credit', p_amount)
    ),
    v_invoice.patient_id, null, v_clinic_user_id, null
  );

  return v_invoice;
end;
$$;

grant execute on function public.reverse_customer_credit_application(uuid, uuid, numeric, text) to authenticated;
