-- FIN-4.8: closes a real duplicate-grant race in grant_customer_credit()
-- (migration 0100), found by this phase's concurrency testing.
--
-- THE GAP: grant_customer_credit()'s duplicate guard is
-- `if exists (select 1 from clinic_customer_credits where
-- source_invoice_id = p_invoice_id) then raise exception ...` - a plain
-- read, and clinic_customer_credits.source_invoice_id had no uniqueness
-- enforced at the database level. Two concurrent grants on the SAME
-- overpaid invoice can both pass that check before either has inserted,
-- and both then insert - a real, duplicate Customer Credit for money
-- that was only ever overpaid once. FIN-4.2's sequential regression
-- suite (scenario 21c) could never have caught this - attemptWithSavepoint
-- runs one attempt at a time, by construction, and this bug only exists
-- when two callers overlap.
--
-- THE FIX: a real UNIQUE constraint on source_invoice_id - the only way
-- to make "at most one credit per invoice" actually race-proof, since
-- there is no existing row to take a `for update` lock on before the
-- first INSERT ever happens (unlike record_payment/apply_customer_credit,
-- migrations 0102/0103, which lock an already-existing invoice row).
-- The function's existing `if exists (...)` check is left in place - it
-- still gives the fast, friendly error in the overwhelmingly common
-- non-concurrent case - with a new EXCEPTION handler around the INSERT
-- that catches the rare concurrent case (a unique_violation) and raises
-- the exact same message instead of a raw constraint-violation error,
-- so the caller never sees a difference between the two paths.
--
-- Every other line of grant_customer_credit is unchanged from migration
-- 0100 - same checks, same order, same ledger posting. No existing row
-- is touched (there is currently at most one credit per invoice in this
-- database - FIN-4.4's migration 0101 and the ordinary UI path both
-- already respect this invariant - so the new constraint has nothing to
-- reject on data that already exists).

alter table public.clinic_customer_credits
  add constraint clinic_customer_credits_source_invoice_unique unique (source_invoice_id);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = v_invoice.clinic_id;

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

-- Signature unchanged - create or replace, no grant/drop needed.
