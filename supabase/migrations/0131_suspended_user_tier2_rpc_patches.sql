-- Critical Safety Closure (Audit II, Critical #3, Tier 2): see migration
-- 0130_suspended_user_tier1_choke_points.sql's header for the full
-- root-cause writeup and the Tier 1 / Tier 2 framing. Tier 1 patched the
-- two shared functions (_caller_role, is_clinic_owner_or_admin) and the
-- clinic_users_select_self RLS policy that together close read access
-- and the ~10 trigger-guarded tables. This migration is Tier 2: 23
-- additional `security definer` RPCs that each independently resolve the
-- calling user's own clinic_users row (role/clinic_id) via their own raw
-- query rather than going through either Tier 1 function - so a
-- Suspended staff member's still-valid session could call any of these
-- directly (or through the app's own normal service layer, which calls
-- them as ordinary RPCs) with full success.
--
-- Every function below is reproduced EXACTLY as it is currently defined
-- (confirmed against the highest-numbered migration that (re)defines
-- each name), with ONLY one condition added to whichever clause resolves
-- the caller's own clinic_users row: `and cu.status = 'Active'` (or the
-- correct alias, or unaliased `and status = 'Active'` where the table
-- has no alias, or - for update_own_profile, whose caller's own row IS
-- the direct UPDATE target rather than a separate resolve-then-authorize
-- step - the same condition added to that UPDATE's own WHERE). No
-- business logic, other queries, or return shapes were changed anywhere.
--
-- Safe to re-run: every block is `create or replace function`, same
-- signature as today: reverse_ledger_transaction, void_invoice,
-- void_payment, reverse_customer_credit_application, grant_customer_
-- credit, apply_customer_credit, refund_customer_credit, create_manual_
-- journal_entry, set_opening_balance, record_supplier_payment, void_
-- supplier_payment, repair_supplier_grn_ledger_postings, cancel_
-- purchase_order, confirm_grn_receipt, adjust_inventory_stock, add_
-- treatment_material, update_treatment_material_quantity, create_staff_
-- invitation, resend_staff_invitation, switch_active_branch, ensure_
-- ledger_provisioned, ensure_ledger_provisioned_multi, update_own_
-- profile. A `grant execute ... to authenticated` is included for each
-- (idempotent even where the signature-unchanged redefining migration
-- didn't re-issue one, since Postgres already carries the grant forward
-- automatically in that case).
--
-- Deliberately excludes _reverse_ledger_transaction_core (0115) - it is
-- NOT granted to authenticated/public (only reachable through the
-- already-patched public void_invoice/void_payment/reverse_ledger_
-- transaction/reverse_customer_credit_application wrappers above), takes
-- p_clinic_id as a trusted argument from an already-authorized caller,
-- and does no clinic_users lookup of its own.

-- 1. reverse_ledger_transaction (source: supabase/migrations/0115_gate_generic_ledger_reversal.sql, confirmed latest)
-- NOTE: 0115 also introduced a NOT-client-callable core,
-- _reverse_ledger_transaction_core(p_clinic_id, p_transaction_id, p_notes)
-- (revoked from public/authenticated), which this public function calls
-- after its own auth/role check passes. The core does no clinic_users
-- lookup at all (auth is fully delegated to this wrapper), is not in the
-- 23-function list, and is NOT patched here.
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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

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


-- 2. void_invoice (source: supabase/migrations/0115_gate_generic_ledger_reversal.sql, confirmed latest)
-- NOTE: no grant execute statement for this exact signature appears in
-- 0115 itself - the signature (uuid, text) is unchanged from migration
-- 0110, whose grant below still governs it (Postgres carries grants
-- across a same-signature CREATE OR REPLACE). Copied here for
-- completeness only; likely does not need to be re-run.
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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id and cu.status = 'Active';

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

grant execute on function public.void_invoice(uuid, text) to authenticated;


-- 3. void_payment (source: supabase/migrations/0115_gate_generic_ledger_reversal.sql, confirmed latest)
-- NOTE: same as void_invoice - no grant statement in 0115 itself; the
-- one from 0110 (signature unchanged) still governs. Copied for
-- completeness only.
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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id and cu.status = 'Active';

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

grant execute on function public.void_payment(uuid, text) to authenticated;


-- 4. reverse_customer_credit_application (source: supabase/migrations/0115_gate_generic_ledger_reversal.sql, confirmed latest)
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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id and cu.status = 'Active';

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


-- 5. grant_customer_credit (source: supabase/migrations/0104_unique_customer_credit_per_invoice.sql, confirmed latest)
-- NOTE: no grant execute statement in 0104 itself ("Signature unchanged -
-- create or replace, no grant/drop needed" per its own footer comment);
-- original grant from 0100 copied below for completeness.
create or replace function public.grant_customer_credit(
  p_invoice_id uuid,
  p_amount numeric default null,
  p_notes text default null
)
returns public.clinic_customer_credits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.clinic_invoices;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_overpayment numeric;
  v_amount numeric;
  v_credit public.clinic_customer_credits;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invoice from public.clinic_invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_invoice.clinic_id and cu.status = 'Active';

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to grant a customer credit.', coalesce(v_role, 'none');
  end if;

  -- Fast, friendly path for the ordinary (non-concurrent) case - the
  -- new unique constraint below is what actually makes this race-proof.
  if exists (select 1 from public.clinic_customer_credits where source_invoice_id = p_invoice_id) then
    raise exception 'A customer credit has already been granted for invoice %.', v_invoice.invoice_number;
  end if;

  v_overpayment := round(-1 * v_invoice.balance, 2);
  if v_overpayment <= 0 then
    raise exception 'Invoice % is not overpaid (balance %).', v_invoice.invoice_number, v_invoice.balance;
  end if;

  v_amount := coalesce(p_amount, v_overpayment);
  if v_amount <= 0 or v_amount > v_overpayment then
    raise exception 'Amount must be between 0 and the overpayment of % (got %).', v_overpayment, v_amount;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_invoice.clinic_id;
  if v_settings.accounts_receivable_account_id is null or v_settings.customer_credit_account_id is null then
    raise exception 'Accounts Receivable or Customer Credits account is not configured for this clinic.';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_invoice.clinic_id;

  begin
    insert into public.clinic_customer_credits (
      clinic_id, patient_id, source_invoice_id, amount, remaining_amount, notes, created_by
    ) values (
      v_invoice.clinic_id, v_invoice.patient_id, v_invoice.id, v_amount, v_amount, p_notes, v_clinic_user_id
    )
    returning * into v_credit;
  exception when unique_violation then
    -- The concurrent case: another grant on this same invoice committed
    -- first, between this function's `if exists` check above and this
    -- INSERT. Same message the fast-path check already gives.
    raise exception 'A customer credit has already been granted for invoice %.', v_invoice.invoice_number;
  end;

  perform public._post_ledger_transaction(
    v_invoice.clinic_id, current_date, 'CustomerCreditGrant', 'customer_credit', v_credit.id,
    'Customer credit granted for overpayment on ' || v_invoice.invoice_number,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', 0, 'credit', v_amount)
    ),
    v_invoice.patient_id, null, v_clinic_user_id, null
  );

  return v_credit;
end;
$$;

grant execute on function public.grant_customer_credit(uuid, numeric, text) to authenticated;


-- 6. apply_customer_credit (source: supabase/migrations/0103_atomic_apply_customer_credit.sql, confirmed latest)
-- NOTE: no grant execute statement in 0103 itself ("Signature unchanged -
-- create or replace, no grant/drop needed" per its own footer comment);
-- original grant from 0100 copied below for completeness.
create or replace function public.apply_customer_credit(
  p_credit_id uuid,
  p_invoice_id uuid,
  p_amount numeric
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_credit public.clinic_customer_credits;
  v_invoice public.clinic_invoices;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_new_amount_paid numeric;
  v_new_balance numeric;
  v_new_status text;
  v_currency text;
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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id and cu.status = 'Active';

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to apply a customer credit.', coalesce(v_role, 'none');
  end if;

  -- Locked here (for update), before it's read - the actual fix. A
  -- second concurrent caller targeting this same invoice (via this
  -- credit or a different one) blocks until this transaction commits or
  -- rolls back, then sees the already-applied balance.
  select * into v_invoice from public.clinic_invoices where id = p_invoice_id and clinic_id = v_credit.clinic_id for update;
  if not found then
    raise exception 'Invoice not found in this clinic';
  end if;

  if v_invoice.patient_id != v_credit.patient_id then
    raise exception 'This credit belongs to a different patient than the target invoice.';
  end if;

  if p_amount > v_credit.remaining_amount then
    raise exception 'Amount (%) exceeds the credit''s remaining balance (%).', p_amount, v_credit.remaining_amount;
  end if;

  if p_amount > v_invoice.balance then
    raise exception 'Amount (%) exceeds invoice %''s outstanding balance (%).', p_amount, v_invoice.invoice_number, v_invoice.balance;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_credit.clinic_id;
  if v_settings.accounts_receivable_account_id is null or v_settings.customer_credit_account_id is null then
    raise exception 'Accounts Receivable or Customer Credits account is not configured for this clinic.';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_credit.clinic_id;

  update public.clinic_customer_credits
  set remaining_amount = remaining_amount - p_amount, updated_at = now()
  where id = v_credit.id;

  -- Mirrors recordPayment()'s own status derivation exactly (Paid when
  -- balance <= 0, Partially Paid when something has been paid, else
  -- Unpaid) - never a competing definition of what these statuses mean.
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

  perform public._post_ledger_transaction(
    v_credit.clinic_id, current_date, 'CustomerCreditApplication', 'customer_credit', v_credit.id,
    'Customer credit applied to ' || v_invoice.invoice_number,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', 0, 'credit', p_amount)
    ),
    v_invoice.patient_id, null, v_clinic_user_id, null
  );

  return v_invoice;
end;
$$;

grant execute on function public.apply_customer_credit(uuid, uuid, numeric) to authenticated;


-- 7. refund_customer_credit (source: supabase/migrations/0100_customer_credits_foundation.sql, confirmed latest - never redefined)
create or replace function public.refund_customer_credit(
  p_credit_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns public.clinic_customer_credits
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_credit public.clinic_customer_credits;
  v_role text;
  v_clinic_user_id uuid;
  v_settings public.clinic_ledger_settings;
  v_cash_account_id uuid;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than 0.';
  end if;

  select * into v_credit from public.clinic_customer_credits where id = p_credit_id;
  if not found then
    raise exception 'Customer credit not found';
  end if;

  select cu.id, cu.role into v_clinic_user_id, v_role
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id and cu.status = 'Active';

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to refund a customer credit.', coalesce(v_role, 'none');
  end if;

  if p_amount > v_credit.remaining_amount then
    raise exception 'Amount (%) exceeds the credit''s remaining balance (%).', p_amount, v_credit.remaining_amount;
  end if;

  select * into v_settings from public.clinic_ledger_settings where clinic_id = v_credit.clinic_id;
  if v_settings.customer_credit_account_id is null then
    raise exception 'Customer Credits account is not configured for this clinic.';
  end if;

  v_cash_account_id := coalesce(
    (v_settings.payment_method_accounts ->> p_payment_method)::uuid,
    v_settings.default_cash_account_id
  );
  if v_cash_account_id is null then
    raise exception 'No cash/bank account is configured for payment method %.', p_payment_method;
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_credit.clinic_id;

  update public.clinic_customer_credits
  set remaining_amount = remaining_amount - p_amount, updated_at = now()
  where id = v_credit.id
  returning * into v_credit;

  perform public._post_ledger_transaction(
    v_credit.clinic_id, current_date, 'CustomerCreditRefund', 'customer_credit', v_credit.id,
    'Customer credit refunded via ' || p_payment_method ||
      case when p_reference is not null then ' (' || p_reference || ')' else '' end ||
      case when p_notes is not null then ' - ' || p_notes else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.customer_credit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_cash_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, null, v_clinic_user_id, null
  );

  return v_credit;
end;
$$;

grant execute on function public.refund_customer_credit(uuid, numeric, text, text, text) to authenticated;


-- 8. create_manual_journal_entry (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
create or replace function public.create_manual_journal_entry(
  p_clinic_id uuid,
  p_transaction_date date,
  p_description text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
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
  v_clinic_user_id uuid;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can create manual journal entries';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  if p_debit_account_id = p_credit_account_id then
    raise exception 'Debit and credit accounts must be different';
  end if;

  if not exists (
    select 1 from public.clinic_ledger_accounts a
    where a.id = p_debit_account_id and a.clinic_id = v_clinic_id and a.active
  ) then
    raise exception 'Debit account not found for this clinic';
  end if;

  if not exists (
    select 1 from public.clinic_ledger_accounts a
    where a.id = p_credit_account_id and a.clinic_id = v_clinic_id and a.active
  ) then
    raise exception 'Credit account not found for this clinic';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  return public._post_ledger_transaction(
    v_clinic_id, p_transaction_date, 'ManualJournal', 'manual', null,
    coalesce(nullif(trim(p_description), ''), 'Manual journal entry')
      || case when p_notes is not null and trim(p_notes) <> '' then ' - ' || trim(p_notes) else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', p_debit_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', p_credit_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, null, v_clinic_user_id, null
  );
end;
$$;

grant execute on function public.create_manual_journal_entry(uuid, date, text, uuid, uuid, numeric, text) to authenticated;


-- 9. set_opening_balance (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
create or replace function public.set_opening_balance(
  p_clinic_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_as_of date default current_date
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
  v_clinic_user_id uuid;
  v_account record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_existing record;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can set opening balances';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Opening balance amount must be zero or greater';
  end if;

  select * into v_account from public.clinic_ledger_accounts a
  where a.id = p_account_id and a.clinic_id = v_clinic_id;

  if v_account.id is null then
    raise exception 'Account not found for this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.opening_balance_equity_account_id is null then
    raise exception 'Opening Balance Equity account is not configured';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  select * into v_existing from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.transaction_type = 'OpeningBalance'
    and t.reference_type = 'opening_balance' and t.reference_id = p_account_id
    and t.reversed_by is null
  order by t.created_at desc
  limit 1;

  if v_existing.id is not null then
    perform public.reverse_ledger_transaction(v_clinic_id, v_existing.id, 'Superseded by a new opening balance');
  end if;

  if p_amount = 0 then
    return null;
  end if;

  if v_account.type in ('Asset', 'Expense') then
    v_new_id := public._post_ledger_transaction(
      v_clinic_id, p_as_of, 'OpeningBalance', 'opening_balance', p_account_id,
      'Opening balance: ' || v_account.name, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', p_account_id, 'debit', p_amount, 'credit', 0),
        jsonb_build_object('account_id', v_settings.opening_balance_equity_account_id, 'debit', 0, 'credit', p_amount)
      ),
      null, null, v_clinic_user_id, null
    );
  else
    v_new_id := public._post_ledger_transaction(
      v_clinic_id, p_as_of, 'OpeningBalance', 'opening_balance', p_account_id,
      'Opening balance: ' || v_account.name, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.opening_balance_equity_account_id, 'debit', p_amount, 'credit', 0),
        jsonb_build_object('account_id', p_account_id, 'debit', 0, 'credit', p_amount)
      ),
      null, null, v_clinic_user_id, null
    );
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.set_opening_balance(uuid, uuid, numeric, date) to authenticated;


-- 10. record_supplier_payment (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
create or replace function public.record_supplier_payment(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_payment_date date,
  p_payment_method text,
  p_amount numeric,
  p_allocations jsonb,
  p_reference text default null,
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
  v_clinic_user_id uuid;
  v_supplier record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_cash_account_id uuid;
  v_payment_id uuid;
  v_transaction_id uuid;
  v_allocation jsonb;
  v_grn_id uuid;
  v_alloc_amount numeric;
  v_allocated_total numeric := 0;
  v_grn_total numeric;
  v_grn_already_paid numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can record supplier payments';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  select * into v_supplier from public.clinic_suppliers s
  where s.id = p_supplier_id and s.clinic_id = v_clinic_id;

  if v_supplier.id is null then
    raise exception 'Supplier not found for this clinic';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Select at least one outstanding GRN to apply this payment against';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.accounts_payable_account_id is null then
    raise exception 'Accounts Payable account is not configured - set it in Accounting Settings first';
  end if;

  v_cash_account_id := coalesce(
    (v_settings.payment_method_accounts ->> p_payment_method)::uuid,
    v_settings.default_cash_account_id
  );

  if v_cash_account_id is null then
    raise exception 'No account is configured for payment method "%" - set a default cash account in Accounting Settings', p_payment_method;
  end if;

  -- Validate every allocation line BEFORE writing anything: each GRN
  -- must belong to this supplier/clinic and be Received, and the
  -- allocation must not exceed that GRN's real-time outstanding balance
  -- (section 6 - reject overpayment rather than inventing a credit
  -- balance concept). Locking each GRN row serializes this against a
  -- concurrent payment being recorded against the same GRN.
  for v_allocation in select * from jsonb_array_elements(p_allocations) loop
    v_grn_id := (v_allocation->>'grn_id')::uuid;
    v_alloc_amount := (v_allocation->>'amount')::numeric;

    if v_grn_id is null or v_alloc_amount is null or v_alloc_amount <= 0 then
      raise exception 'Each allocation must have a valid GRN and a positive amount';
    end if;

    perform 1 from public.clinic_goods_received_notes g
    where g.id = v_grn_id and g.clinic_id = v_clinic_id and g.supplier_id = p_supplier_id
      and g.status = 'Received'
    for update;

    if not found then
      raise exception 'GRN not found, not received, or does not belong to this supplier';
    end if;

    select coalesce(sum(gi.quantity_received * gi.unit_cost), 0) into v_grn_total
    from public.clinic_grn_items gi
    where gi.grn_id = v_grn_id;

    select coalesce(sum(a.amount), 0) into v_grn_already_paid
    from public.clinic_supplier_payment_allocations a
    join public.clinic_supplier_payments p on p.id = a.supplier_payment_id
    where a.grn_id = v_grn_id and p.status = 'Posted';

    if v_alloc_amount > (v_grn_total - v_grn_already_paid) then
      raise exception 'Allocation of % exceeds the outstanding balance of % for this GRN', v_alloc_amount, (v_grn_total - v_grn_already_paid);
    end if;

    v_allocated_total := v_allocated_total + v_alloc_amount;
  end loop;

  -- Every kobo/cent of the payment must be allocated - there is no
  -- "unapplied supplier credit" account in this system, so a payment
  -- that doesn't fully allocate would leave money nowhere accounted for.
  if v_allocated_total <> p_amount then
    raise exception 'Allocations (%) must add up to exactly the payment amount (%)', v_allocated_total, p_amount;
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  insert into public.clinic_supplier_payments (
    clinic_id, supplier_id, payment_date, payment_method, amount, reference, notes, created_by
  )
  values (
    v_clinic_id, p_supplier_id, p_payment_date, p_payment_method, p_amount, p_reference, p_notes, v_clinic_user_id
  )
  returning id into v_payment_id;

  insert into public.clinic_supplier_payment_allocations (clinic_id, supplier_payment_id, grn_id, amount)
  select
    v_clinic_id,
    v_payment_id,
    (entry->>'grn_id')::uuid,
    (entry->>'amount')::numeric
  from jsonb_array_elements(p_allocations) as entry;

  v_transaction_id := public._post_ledger_transaction(
    v_clinic_id, p_payment_date, 'Payment', 'supplier_payment', v_payment_id,
    'Supplier payment: ' || v_supplier.name
      || case when p_reference is not null and trim(p_reference) <> '' then ' (Ref: ' || trim(p_reference) || ')' else '' end,
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.accounts_payable_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_cash_account_id, 'debit', 0, 'credit', p_amount)
    ),
    null, p_supplier_id, v_clinic_user_id, null
  );

  return v_payment_id;
end;
$$;

grant execute on function public.record_supplier_payment(uuid, uuid, date, text, numeric, jsonb, text, text) to authenticated;


-- 11. void_supplier_payment (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
create or replace function public.void_supplier_payment(
  p_clinic_id uuid,
  p_payment_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_payment record;
  v_transaction_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can void supplier payments';
  end if;

  select * into v_payment from public.clinic_supplier_payments p
  where p.id = p_payment_id and p.clinic_id = v_clinic_id
  for update;

  if v_payment.id is null then
    raise exception 'Supplier payment not found for this clinic';
  end if;

  if v_payment.status = 'Voided' then
    raise exception 'This payment has already been voided';
  end if;

  select t.id into v_transaction_id from public.clinic_ledger_transactions t
  where t.clinic_id = v_clinic_id and t.reference_type = 'supplier_payment' and t.reference_id = p_payment_id
    and t.reversed_by is null;

  update public.clinic_supplier_payments
  set status = 'Voided', voided_at = now(), voided_by = v_clinic_user_id, void_reason = p_reason, updated_at = now()
  where id = p_payment_id;

  if v_transaction_id is not null then
    perform public.reverse_ledger_transaction(v_clinic_id, v_transaction_id, coalesce(p_reason, 'Supplier payment voided'));
  end if;
end;
$$;

grant execute on function public.void_supplier_payment(uuid, uuid, text) to authenticated;


-- 12. repair_supplier_grn_ledger_postings (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
create or replace function public.repair_supplier_grn_ledger_postings(
  p_clinic_id uuid,
  p_supplier_id uuid
)
returns table (
  grn_id uuid,
  grn_number text,
  amount numeric,
  ledger_transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_supplier record;
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_grn record;
  v_total numeric;
  v_existing uuid;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can repair ledger postings';
  end if;

  select * into v_supplier from public.clinic_suppliers s
  where s.id = p_supplier_id and s.clinic_id = v_clinic_id;

  if v_supplier.id is null then
    raise exception 'Supplier not found for this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
  select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = v_clinic_id;

  if v_settings.inventory_account_id is null or v_settings.accounts_payable_account_id is null then
    raise exception 'Inventory or Accounts Payable account is not configured - set it in Accounting Settings first';
  end if;

  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  for v_grn in
    select g.id, g.grn_number, g.date_received
    from public.clinic_goods_received_notes g
    where g.clinic_id = v_clinic_id and g.supplier_id = p_supplier_id and g.status = 'Received'
    order by g.date_received
    for update
  loop
    select t.id into v_existing from public.clinic_ledger_transactions t
    where t.clinic_id = v_clinic_id and t.reference_type = 'grn' and t.reference_id = v_grn.id
      and t.reversed_by is null;

    if v_existing is not null then
      continue;
    end if;

    select coalesce(sum(gi.quantity_received * gi.unit_cost), 0) into v_total
    from public.clinic_grn_items gi
    where gi.grn_id = v_grn.id;

    if v_total <= 0 then
      continue;
    end if;

    v_new_id := public._post_ledger_transaction(
      v_clinic_id, v_grn.date_received, 'InventoryReceipt', 'grn', v_grn.id,
      'Goods received (reconciliation repair): ' || v_grn.grn_number, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_settings.inventory_account_id, 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.accounts_payable_account_id, 'debit', 0, 'credit', v_total)
      ),
      null, p_supplier_id, v_clinic_user_id, null
    );

    grn_id := v_grn.id;
    grn_number := v_grn.grn_number;
    amount := v_total;
    ledger_transaction_id := v_new_id;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.repair_supplier_grn_ledger_postings(uuid, uuid) to authenticated;


-- 13. cancel_purchase_order (source: supabase/migrations/0122_po_cancel_cascades_to_grns.sql, confirmed latest)
-- NOTE: no grant execute statement in 0122 itself (signature unchanged
-- from 0024); original grant from 0024 copied below for completeness.
create or replace function public.cancel_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_status text;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id, po.status
    into v_clinic_id, v_role, v_clinic_user_id, v_status
  from public.clinic_users cu
  join public.clinic_purchase_orders po on po.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and po.id = p_po_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'Purchase order not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to cancel this purchase order';
  end if;

  -- Cancelling a fully/partially Received PO is out of scope for V1 (no
  -- reversal system) - only pre-receipt cancellation is supported.
  if v_status in ('Received', 'Partially Received') then
    raise exception 'Cannot cancel a purchase order that has already received goods';
  end if;

  if v_status = 'Cancelled' then
    return;
  end if;

  update public.clinic_purchase_orders
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = v_clinic_user_id, updated_at = now()
  where id = p_po_id;

  -- Full-app audit fix H12: cancel every still-Draft GRN linked to this
  -- PO too - a Received one is already financially posted and out of
  -- scope for the same reason cancelling a Received PO is.
  update public.clinic_goods_received_notes
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = v_clinic_user_id, updated_at = now()
  where purchase_order_id = p_po_id
    and status = 'Draft';
end;
$$;

grant execute on function public.cancel_purchase_order(uuid) to authenticated;


-- 14. confirm_grn_receipt (source: supabase/migrations/0122_po_cancel_cascades_to_grns.sql, confirmed latest)
-- NOTE: no grant execute statement in 0122 itself (signature unchanged
-- since 0025/0027/0042); original grant copied below for completeness.
create or replace function public.confirm_grn_receipt(p_grn_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_grn record;
  v_item record;
  v_ordered numeric;
  v_already_received numeric;
  v_new_qty numeric;
  v_po_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.clinic_goods_received_notes g on g.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and g.id = p_grn_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'GRN not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to confirm goods received';
  end if;

  select * into v_grn from public.clinic_goods_received_notes where id = p_grn_id for update;

  if v_grn.status = 'Received' then
    return; -- idempotent no-op: double-click / refresh / retry
  end if;

  if v_grn.status = 'Cancelled' then
    raise exception 'Cannot confirm a cancelled GRN';
  end if;

  -- Serialize against a sibling GRN for the same PO being confirmed
  -- concurrently - locking this GRN's own row does not do that on its own.
  if v_grn.purchase_order_id is not null then
    select status into v_po_status from public.clinic_purchase_orders where id = v_grn.purchase_order_id for update;

    -- Full-app audit fix H12: refuse outright if the parent PO has been
    -- cancelled - closes the "cancel PO, then confirm its still-Draft
    -- GRN anyway" path even if a Draft GRN somehow still exists (the
    -- cascade above is the primary fix; this is the backstop).
    if v_po_status = 'Cancelled' then
      raise exception 'Cannot confirm receipt against a cancelled purchase order';
    end if;
  end if;

  -- Full-app audit fix H13: refuse to confirm if any line item has a
  -- non-positive unit cost - checked up front, before any inventory
  -- write, so a bad line can never partially post.
  if exists (
    select 1 from public.clinic_grn_items
    where grn_id = p_grn_id and coalesce(unit_cost, 0) <= 0
  ) then
    raise exception 'Every line item must have a unit cost greater than 0 before this GRN can be confirmed.';
  end if;

  for v_item in select * from public.clinic_grn_items where grn_id = p_grn_id loop
    if v_item.purchase_order_item_id is not null then
      select quantity into v_ordered
      from public.clinic_purchase_order_items
      where id = v_item.purchase_order_item_id;

      select coalesce(sum(gi2.quantity_received), 0) into v_already_received
      from public.clinic_grn_items gi2
      join public.clinic_goods_received_notes g2 on g2.id = gi2.grn_id
      where gi2.purchase_order_item_id = v_item.purchase_order_item_id and g2.status = 'Received';

      if v_already_received + v_item.quantity_received > v_ordered then
        raise exception 'Over-receipt not allowed for this item';
      end if;
    end if;

    if v_item.quantity_received > 0 then
      update public.clinic_inventory_items
      set quantity = quantity + v_item.quantity_received,
          cost_per_unit = v_item.unit_cost,
          batch_number = coalesce(v_item.batch_number, batch_number),
          expiry_date = coalesce(v_item.expiry_date, expiry_date),
          updated_at = now()
      where id = v_item.inventory_item_id and clinic_id = v_clinic_id
      returning quantity into v_new_qty;

      if not found then
        raise exception 'Inventory item not found for this clinic';
      end if;

      insert into public.clinic_inventory_movements
        (clinic_id, inventory_item_id, movement_type, quantity_change, quantity_before, quantity_after,
         reason, notes, created_by, grn_id, unit_cost, batch_number, expiry_date, supplier_id)
      values
        (v_clinic_id, v_item.inventory_item_id, 'Increase', v_item.quantity_received,
         v_new_qty - v_item.quantity_received, v_new_qty, 'Restock',
         'GRN ' || v_grn.grn_number, v_clinic_user_id, p_grn_id,
         v_item.unit_cost, v_item.batch_number, v_item.expiry_date, v_grn.supplier_id);
    end if;
  end loop;

  update public.clinic_goods_received_notes
  set status = 'Received', received_at = now(), received_by = v_clinic_user_id, updated_at = now()
  where id = p_grn_id;

  if v_grn.purchase_order_id is not null then
    update public.clinic_purchase_orders po
    set status = (
      select case when bool_and(coalesce(recv.total_received, 0) >= poi.quantity) then 'Received' else 'Partially Received' end
      from public.clinic_purchase_order_items poi
      left join (
        select gi.purchase_order_item_id, sum(gi.quantity_received) as total_received
        from public.clinic_grn_items gi
        join public.clinic_goods_received_notes g on g.id = gi.grn_id
        where g.status = 'Received'
        group by gi.purchase_order_item_id
      ) recv on recv.purchase_order_item_id = poi.id
      where poi.purchase_order_id = po.id
    ),
    updated_at = now()
    where po.id = v_grn.purchase_order_id;
  end if;
end;
$$;

grant execute on function public.confirm_grn_receipt(uuid) to authenticated;


-- 15. adjust_inventory_stock (source: supabase/migrations/0123_link_supplier_returns_to_grn.sql, confirmed latest)
create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_delta numeric,
  p_reason text,
  p_notes text default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_supplier_id uuid default null,
  p_patient_id uuid default null,
  p_treatment_id uuid default null,
  p_reference text default null,
  p_grn_id uuid default null
)
returns clinic_inventory_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_before numeric;
  v_after numeric;
  v_cost_per_unit numeric;
  v_item public.clinic_inventory_items;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_delta = 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.clinic_inventory_items ii on ii.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and ii.id = p_item_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'Material not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to adjust stock';
  end if;

  if p_reason not in (
    'Restock', 'Used', 'Damaged', 'Expired',
    'Correction', 'Initial Stock', 'Returned to Supplier', 'Other'
  ) then
    raise exception 'Invalid movement reason';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.clinic_suppliers s
    where s.id = p_supplier_id and s.clinic_id = v_clinic_id
  ) then
    raise exception 'Supplier not found for this clinic';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.clinic_id = v_clinic_id
  ) then
    raise exception 'Patient not found for this clinic';
  end if;

  if p_treatment_id is not null and not exists (
    select 1 from public.clinic_treatments t
    where t.id = p_treatment_id and t.clinic_id = v_clinic_id
  ) then
    raise exception 'Treatment not found for this clinic';
  end if;

  -- Full-app audit fix H14: p_grn_id must belong to this clinic (and, if
  -- a supplier was also given, to that same supplier - a return can't
  -- plausibly be "from" a GRN belonging to a different supplier).
  if p_grn_id is not null and not exists (
    select 1 from public.clinic_goods_received_notes g
    where g.id = p_grn_id
      and g.clinic_id = v_clinic_id
      and (p_supplier_id is null or g.supplier_id = p_supplier_id)
  ) then
    raise exception 'Delivery not found for this clinic/supplier';
  end if;

  select quantity, cost_per_unit into v_before, v_cost_per_unit
  from public.clinic_inventory_items
  where id = p_item_id and clinic_id = v_clinic_id
  for update;

  v_after := v_before + p_delta;

  if v_after < 0 then
    raise exception 'Cannot remove more than the current stock (% available).', v_before;
  end if;

  update public.clinic_inventory_items
  set quantity = v_after, updated_at = now()
  where id = p_item_id and clinic_id = v_clinic_id
  returning * into v_item;

  insert into public.clinic_inventory_movements (
    clinic_id, inventory_item_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, notes, created_by,
    batch_number, expiry_date, supplier_id, patient_id, treatment_id, reference,
    unit_cost, grn_id
  )
  values (
    v_clinic_id, p_item_id, case when p_delta > 0 then 'Increase' else 'Decrease' end, p_delta,
    v_before, v_after, p_reason, nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    nullif(trim(coalesce(p_batch_number, '')), ''), p_expiry_date, p_supplier_id, p_patient_id, p_treatment_id,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_cost_per_unit, p_grn_id
  );

  return v_item;
end;
$function$;

grant execute on function public.adjust_inventory_stock(
  uuid, numeric, text, text, text, date, uuid, uuid, uuid, text, uuid
) to authenticated;


-- 16. add_treatment_material (source: supabase/migrations/0088_treatment_material_usage.sql, confirmed latest - never redefined)
create or replace function public.add_treatment_material(
  p_treatment_plan_item_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns public.treatment_material_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_patient_id uuid;
  v_before numeric;
  v_after numeric;
  v_current_cost numeric;
  v_existing public.treatment_material_usage;
  v_new_quantity numeric;
  v_new_unit_cost numeric;
  v_result public.treatment_material_usage;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.treatment_plan_items tpi on tpi.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and tpi.id = p_treatment_plan_item_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'Treatment not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to record material consumption';
  end if;

  if not exists (
    select 1 from public.clinic_inventory_items ii
    where ii.id = p_inventory_item_id and ii.clinic_id = v_clinic_id
  ) then
    raise exception 'Material not found for this clinic';
  end if;

  select tp.patient_id into v_patient_id
  from public.treatment_plan_items tpi
  join public.treatment_plans tp on tp.id = tpi.treatment_plan_id
  where tpi.id = p_treatment_plan_item_id;

  select quantity, cost_per_unit into v_before, v_current_cost
  from public.clinic_inventory_items
  where id = p_inventory_item_id and clinic_id = v_clinic_id
  for update;

  v_after := v_before - p_quantity;

  if v_after < 0 then
    raise exception 'Cannot use more than the current stock (% available).', v_before;
  end if;

  update public.clinic_inventory_items
  set quantity = v_after, updated_at = now()
  where id = p_inventory_item_id and clinic_id = v_clinic_id;

  insert into public.clinic_inventory_movements (
    clinic_id, inventory_item_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason, notes, created_by,
    unit_cost, patient_id, treatment_plan_item_id
  )
  values (
    v_clinic_id, p_inventory_item_id, 'Decrease', -p_quantity,
    v_before, v_after, 'Used', nullif(trim(coalesce(p_notes, '')), ''), v_clinic_user_id,
    v_current_cost, v_patient_id, p_treatment_plan_item_id
  );

  select * into v_existing
  from public.treatment_material_usage
  where treatment_plan_item_id = p_treatment_plan_item_id
    and inventory_item_id = p_inventory_item_id;

  if v_existing.id is null then
    insert into public.treatment_material_usage (
      clinic_id, treatment_plan_item_id, inventory_item_id, quantity, unit_cost, created_by
    )
    values (
      v_clinic_id, p_treatment_plan_item_id, p_inventory_item_id, p_quantity, v_current_cost, v_clinic_user_id
    )
    returning * into v_result;
  else
    v_new_quantity := v_existing.quantity + p_quantity;
    v_new_unit_cost := (v_existing.quantity * v_existing.unit_cost + p_quantity * v_current_cost) / v_new_quantity;

    update public.treatment_material_usage
    set quantity = v_new_quantity, unit_cost = v_new_unit_cost, updated_at = now()
    where id = v_existing.id
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

grant execute on function public.add_treatment_material(uuid, uuid, numeric, text) to authenticated;


-- 17. update_treatment_material_quantity (source: supabase/migrations/0105_atomic_update_treatment_material_quantity.sql, confirmed latest)
-- NOTE: no grant execute statement in 0105 itself ("Signature unchanged -
-- create or replace, no grant/drop needed" per its own footer comment);
-- original grant from 0088 copied below for completeness.
create or replace function public.update_treatment_material_quantity(
  p_usage_id uuid,
  p_new_quantity numeric
)
returns public.treatment_material_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_clinic_user_id uuid;
  v_usage public.treatment_material_usage;
  v_patient_id uuid;
  v_delta numeric;
  v_before numeric;
  v_after numeric;
  v_current_cost numeric;
  v_new_unit_cost numeric;
  v_result public.treatment_material_usage;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Quantity cannot be negative.';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  join public.treatment_material_usage tmu on tmu.clinic_id = cu.clinic_id
  where cu.auth_user_id = v_uid and tmu.id = p_usage_id and cu.status = 'Active';

  if v_clinic_id is null then
    raise exception 'Material usage record not found or not accessible';
  end if;

  if v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Not authorized to record material consumption';
  end if;

  -- Locked here (for update), before v_delta is computed against it -
  -- the actual fix. A second concurrent caller targeting this same
  -- usage row blocks until this transaction commits or rolls back.
  select * into v_usage
  from public.treatment_material_usage
  where id = p_usage_id and clinic_id = v_clinic_id
  for update;

  v_delta := p_new_quantity - v_usage.quantity;

  if v_delta = 0 then
    return v_usage;
  end if;

  select tp.patient_id into v_patient_id
  from public.treatment_plan_items tpi
  join public.treatment_plans tp on tp.id = tpi.treatment_plan_id
  where tpi.id = v_usage.treatment_plan_item_id;

  if v_delta > 0 then
    select quantity, cost_per_unit into v_before, v_current_cost
    from public.clinic_inventory_items
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id
    for update;

    v_after := v_before - v_delta;

    if v_after < 0 then
      raise exception 'Cannot use more than the current stock (% available).', v_before;
    end if;

    update public.clinic_inventory_items
    set quantity = v_after, updated_at = now()
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id;

    insert into public.clinic_inventory_movements (
      clinic_id, inventory_item_id, movement_type, quantity_change,
      quantity_before, quantity_after, reason, created_by,
      unit_cost, patient_id, treatment_plan_item_id
    )
    values (
      v_clinic_id, v_usage.inventory_item_id, 'Decrease', -v_delta,
      v_before, v_after, 'Used', v_clinic_user_id,
      v_current_cost, v_patient_id, v_usage.treatment_plan_item_id
    );

    v_new_unit_cost := (v_usage.quantity * v_usage.unit_cost + v_delta * v_current_cost) / p_new_quantity;
  else
    select quantity into v_before
    from public.clinic_inventory_items
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id
    for update;

    v_after := v_before + abs(v_delta);

    update public.clinic_inventory_items
    set quantity = v_after, updated_at = now()
    where id = v_usage.inventory_item_id and clinic_id = v_clinic_id;

    insert into public.clinic_inventory_movements (
      clinic_id, inventory_item_id, movement_type, quantity_change,
      quantity_before, quantity_after, reason, created_by,
      unit_cost, patient_id, treatment_plan_item_id
    )
    values (
      v_clinic_id, v_usage.inventory_item_id, 'Increase', abs(v_delta),
      v_before, v_after, 'Consumption Reversal', v_clinic_user_id,
      v_usage.unit_cost, v_patient_id, v_usage.treatment_plan_item_id
    );

    -- Reducing quantity never changes the remaining portion's cost basis -
    -- only the already-consumed amount shrinks, at the same weighted-
    -- average cost the line already carried.
    v_new_unit_cost := v_usage.unit_cost;
  end if;

  if p_new_quantity = 0 then
    delete from public.treatment_material_usage where id = p_usage_id;
    return null;
  end if;

  update public.treatment_material_usage
  set quantity = p_new_quantity, unit_cost = v_new_unit_cost, updated_at = now()
  where id = p_usage_id
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.update_treatment_material_quantity(uuid, numeric) to authenticated;


-- 18. create_staff_invitation (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
-- NOTE: unaliased table reference (`from public.clinic_users where ...`,
-- no `cu` alias), so the added condition is unaliased `status = 'Active'`.
-- Confirmed this is the ONLY current overload: the older 0008-era
-- resend/create_staff_invitation signatures were each explicitly DROPped
-- by later migrations before a new signature was created (0008 -> dropped
-- by 0017 -> recreated -> dropped by 0048 -> recreated -> dropped by 0062
-- -> this version) - no separate legacy overload survives alongside this
-- one today.
create or replace function public.create_staff_invitation(
  p_clinic_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_token text
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_clinic_id uuid;
  v_caller_clinic_user_id uuid;
  v_caller_role text;
  v_email text := lower(trim(p_email));
  v_invitation_id uuid;
  v_expires_at timestamptz;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select clinic_id, id, role
    into v_caller_clinic_id, v_caller_clinic_user_id, v_caller_role
  from public.clinic_users
  where auth_user_id = v_uid and clinic_id = p_clinic_id and status = 'Active';

  if v_caller_clinic_id is null then
    raise exception 'Not linked to a clinic';
  end if;

  if v_caller_role not in ('Owner', 'Admin') then
    raise exception 'Only clinic owners and admins can invite staff';
  end if;

  if p_role not in ('Admin', 'Dentist', 'Receptionist') then
    raise exception 'Invalid role';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please provide a valid email address';
  end if;

  if exists (
    select 1 from public.clinic_users
    where clinic_id = v_caller_clinic_id and lower(email) = v_email
  ) then
    raise exception 'This person is already a staff member of this clinic';
  end if;

  if exists (
    select 1 from public.clinic_users where lower(email) = v_email
  ) then
    raise exception 'This email already belongs to a staff member at another clinic';
  end if;

  delete from public.staff_invitations
  where clinic_id = v_caller_clinic_id
    and lower(email) = v_email
    and accepted_at is null
    and staff_invitations.expires_at < now();

  if exists (
    select 1 from public.staff_invitations
    where clinic_id = v_caller_clinic_id
      and lower(email) = v_email
      and accepted_at is null
  ) then
    raise exception 'An invitation is already pending for this email';
  end if;

  v_expires_at := now() + interval '7 days';

  insert into public.staff_invitations (
    clinic_id, email, full_name, role, token, invited_by, expires_at
  )
  values (
    v_caller_clinic_id, v_email, trim(p_full_name), p_role, p_token,
    v_caller_clinic_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_staff_invitation(uuid, text, text, text, text) to authenticated;


-- 19. resend_staff_invitation (source: supabase/migrations/0062_fix_arbitrary_branch_pick_rpcs.sql, confirmed latest)
-- NOTE: same unaliased-table situation as create_staff_invitation above,
-- and same confirmation - the older 0008-era (uuid,text) signature was
-- explicitly DROPped along the 0017 -> 0048 -> 0062 chain and does not
-- survive as a separate live overload. Only one current signature:
-- (p_clinic_id uuid, p_invitation_id uuid, p_token text).
create or replace function public.resend_staff_invitation(
  p_clinic_id uuid,
  p_invitation_id uuid,
  p_token text
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_clinic_id uuid;
  v_caller_role text;
  v_invitation_clinic_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  select clinic_id, role into v_caller_clinic_id, v_caller_role
  from public.clinic_users
  where auth_user_id = v_uid and clinic_id = p_clinic_id and status = 'Active';

  if v_caller_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_caller_role not in ('Owner', 'Admin') then
    raise exception 'Only clinic owners and admins can resend invitations';
  end if;

  select clinic_id into v_invitation_clinic_id
  from public.staff_invitations
  where id = p_invitation_id;

  if v_invitation_clinic_id is null or v_invitation_clinic_id <> v_caller_clinic_id then
    raise exception 'Invitation not found';
  end if;

  v_expires_at := now() + interval '7 days';

  update public.staff_invitations
  set token = p_token, expires_at = v_expires_at
  where id = p_invitation_id and accepted_at is null;

  if not found then
    raise exception 'This invitation has already been accepted';
  end if;

  return query select p_token, v_expires_at;
end;
$$;

grant execute on function public.resend_staff_invitation(uuid, uuid, text) to authenticated;


-- 20. switch_active_branch (source: supabase/migrations/0055_organizations.sql, confirmed latest)
-- NOTE: the caller's-own-row check here is an `if not exists (...)` guard
-- (unaliased table, no separate role/clinic_id resolution into
-- variables) rather than the usual `select ... into` pattern - the same
-- mechanical rule was applied to that exists-subquery's WHERE clause.
-- This function's own migration-0017 header comment explicitly frames it
-- as "a pure UX convenience, never a security boundary" since RLS is the
-- real gate underneath - but per the task's scope it is one of the named
-- 23, so the same gate was still added.
create or replace function public.switch_active_branch(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.organization_users where auth_user_id = v_uid
  ) then
    raise exception 'Not a member of any organization';
  end if;

  if not exists (
    select 1 from public.clinic_users
    where auth_user_id = v_uid and clinic_id = p_clinic_id and status = 'Active'
  ) then
    raise exception 'You do not have access to this branch';
  end if;

  update public.organization_users
  set active_clinic_id = p_clinic_id
  where auth_user_id = v_uid;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;


-- 21. ensure_ledger_provisioned (source: supabase/migrations/0059_fix_ensure_ledger_provisioned_clinic_scoping.sql, confirmed latest)
create or replace function public.ensure_ledger_provisioned(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id and cu.status = 'Active'
  ) then
    raise exception 'You do not have access to this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(p_clinic_id);
end;
$$;

grant execute on function public.ensure_ledger_provisioned(uuid) to authenticated;


-- 22. ensure_ledger_provisioned_multi (source: supabase/migrations/0066_batch_org_financials_ebit_profitability.sql, confirmed latest - never redefined)
create or replace function public.ensure_ledger_provisioned_multi(p_clinic_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  foreach v_clinic_id in array p_clinic_ids loop
    if exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = v_uid and cu.clinic_id = v_clinic_id and cu.status = 'Active'
    ) then
      perform public._ensure_ledger_provisioned_for_clinic(v_clinic_id);
    end if;
  end loop;
end;
$$;

grant execute on function public.ensure_ledger_provisioned_multi(uuid[]) to authenticated;


-- 23. update_own_profile (source: supabase/migrations/0126_self_profile_update.sql, confirmed latest)
-- NOTE: structurally different from every other function here - there is
-- no separate SELECT that resolves the caller's clinic_users row before
-- authorizing a subsequent action; the caller's own row IS the direct
-- target of an UPDATE, gated only by `where auth_user_id = v_uid`. The
-- same mechanical rule (add "and status = 'Active'" to that WHERE) was
-- applied directly to the UPDATE's own WHERE clause. Worth a deliberate
-- look: this makes a Suspended user's own profile-name/phone edit fail
-- once patched, which is presumably the intended effect (no residual
-- self-service action survives suspension) but is worth confirming
-- against product intent since it's a self-service action, not a
-- financial/administrative one like the other 22.
create or replace function public.update_own_profile(
  p_full_name text,
  p_phone text
)
returns setof public.clinic_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;

  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Full name cannot be empty.';
  end if;

  return query
    update public.clinic_users
    set full_name = trim(p_full_name),
        phone = nullif(trim(coalesce(p_phone, '')), '')
    where auth_user_id = v_uid and status = 'Active'
    returning *;
end;
$$;

grant execute on function public.update_own_profile(text, text) to authenticated;
