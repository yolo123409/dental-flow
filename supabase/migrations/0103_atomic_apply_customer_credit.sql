-- FIN-4.8: closes the same class of lost-update race migration 0102
-- fixed in record_payment(), found here in apply_customer_credit()
-- (migration 0100) by the same concurrency testing.
--
-- THE GAP: apply_customer_credit() reads clinic_invoices with a plain
-- SELECT (no row lock), then later does an ABSOLUTE-value UPDATE
-- (amount_paid = v_new_amount_paid, balance = v_new_balance) computed
-- from that stale read. The credit's OWN remaining_amount is already
-- safe - it's decremented with a relative `set remaining_amount =
-- remaining_amount - p_amount`, which Postgres resolves against the
-- row's live value at write time, and the table's own
-- `check (remaining_amount >= 0)` constraint (migration 0100) rejects
-- any double-spend outright. But if two DIFFERENT credits belonging to
-- the same patient are applied to the SAME invoice concurrently, both
-- read the same stale invoice snapshot and the second UPDATE silently
-- overwrites the first - exactly recordPayment()'s bug, on a different
-- write path to the same clinic_invoices columns.
--
-- THE FIX: `select ... for update` on both the credit and the invoice,
-- taken as early as this function reads each of them - same technique
-- as record_payment() (migration 0102). Locking the credit row too
-- (not strictly required for money-safety, the CHECK constraint already
-- guarantees that) means a concurrent double-apply of the SAME credit
-- now fails with this function's own friendly "exceeds the credit's
-- remaining balance" exception instead of a raw Postgres constraint-
-- violation error - a caller-experience improvement, not a behavior
-- change. Every other line of this function is unchanged from migration
-- 0100 - same checks, same order, same ledger posting.

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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_credit.clinic_id;

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

-- Signature unchanged - create or replace, no grant/drop needed.
