-- Fixes the same bug class as migrations 0058 and 0059 (arbitrary,
-- unordered "pick a clinic_users row" resolution instead of scoping to
-- an explicit branch), found live during a production-hardening audit
-- to still be present in 9 functions that 0058/0059 did not touch:
--
--   select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
--   from public.clinic_users cu where cu.auth_user_id = v_uid limit 1;
--
-- (create_staff_invitation/resend_staff_invitation have the same defect
-- without an explicit "limit 1" - a bare `select ... into` over a
-- multi-row result silently keeps the first row PL/pgSQL happens to
-- read, with no ORDER BY to make that deterministic.)
--
-- This was safe when every person had at most one clinic_users row. Once
-- multi-branch organizations exist, a CEO/Member can hold one row per
-- branch, and Postgres's "first row returned" is arbitrary - NOT the
-- branch actually active in the caller's UI. Concrete impact before this
-- fix: ledger writes (manual journal entries, reversals, opening
-- balances, supplier payments/voids/repairs) fail with a spurious
-- "not found for this clinic" on any branch other than whichever one
-- Postgres happens to return first for that user, and
-- get_supplier_ledger_ap_balance can SILENTLY report $0 owed for a
-- supplier that has a real outstanding balance. create_staff_invitation/
-- resend_staff_invitation can invite/resend into the wrong branch
-- entirely. None of this is a cross-tenant leak (the arbitrarily-picked
-- clinic is always one the caller genuinely belongs to) - it is a
-- multi-branch correctness bug, exactly like 0059's ensure_ledger_
-- provisioned() case.
--
-- Fix: same shape as 0058/0059 - each function gains a new, REQUIRED
-- p_clinic_id parameter (placed first, matching 0058/0059's own
-- convention) and resolves/validates the caller's membership of that
-- SPECIFIC clinic instead of picking one arbitrarily. For the
-- SECURITY DEFINER functions this is both the resolution and the
-- authorization check in one step (no matching row => v_clinic_id stays
-- null => the function's own pre-existing "no clinic found" /
-- "not linked to a clinic" exception fires, unchanged). For
-- get_supplier_ledger_ap_balance (security invoker) RLS on
-- clinic_ledger_entries/clinic_ledger_transactions still independently
-- governs visibility underneath the explicit filter, exactly as
-- reasoned in 0058's comment for the sibling read RPCs.
--
-- Parameter-list changes mean CREATE OR REPLACE would add a new,
-- separate overload rather than fix the existing one in place - so the
-- old signatures are explicitly dropped first, same as 0058/0059, to
-- avoid leaving the broken versions still callable side by side with
-- the fixed ones. reverse_ledger_transaction is recreated before
-- set_opening_balance/void_supplier_payment, which call it internally
-- and are updated in the same migration to pass the now-required
-- p_clinic_id through.
--
-- All business logic, validation, and return shapes are otherwise
-- completely unchanged - only the clinic-resolution/authorization step
-- and each affected internal call site's argument list. Safe to re-run:
-- drop-if-exists + create.
--
-- services/ledger.ts, services/supplierPayments.ts and
-- services/staffInvitations.ts (the only callers of any of these 9 RPCs
-- anywhere in the codebase) are updated in the same change to pass
-- getCurrentClinicId() explicitly.

/* ============================================================ */
/* 1. reverse_ledger_transaction - recreated first since two other  */
/*    functions below call it internally.                            */
/* ============================================================ */

drop function if exists public.reverse_ledger_transaction(uuid, text);

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
  v_clinic_user_id uuid;
  v_original record;
  v_entries jsonb;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.clinic_id, cu.role, cu.id into v_clinic_id, v_role, v_clinic_user_id
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

  if v_clinic_id is null then
    raise exception 'No clinic found for this user';
  end if;

  if v_role not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin can reverse ledger transactions';
  end if;

  select * into v_original from public.clinic_ledger_transactions t
  where t.id = p_transaction_id and t.clinic_id = v_clinic_id;

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
    v_clinic_id, current_date, 'Reversal', 'reversal', v_original.id,
    'Reversal of: ' || v_original.description
      || case when p_notes is not null and trim(p_notes) <> '' then ' - ' || trim(p_notes) else '' end,
    v_original.currency, v_entries,
    v_original.patient_id, v_original.supplier_id, v_clinic_user_id, v_original.id
  );

  update public.clinic_ledger_transactions set reversed_by = v_new_id where id = v_original.id;

  return v_new_id;
end;
$$;

grant execute on function public.reverse_ledger_transaction(uuid, uuid, text) to authenticated;

/* ============================================================ */
/* 2. create_manual_journal_entry                                    */
/* ============================================================ */

drop function if exists public.create_manual_journal_entry(date, text, uuid, uuid, numeric, text);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 3. set_opening_balance - internal reverse_ledger_transaction call */
/*    updated to pass v_clinic_id as the new first argument.         */
/* ============================================================ */

drop function if exists public.set_opening_balance(uuid, numeric, date);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 4. record_supplier_payment                                        */
/* ============================================================ */

drop function if exists public.record_supplier_payment(uuid, date, text, numeric, jsonb, text, text);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 5. void_supplier_payment - internal reverse_ledger_transaction    */
/*    call updated to pass v_clinic_id as the new first argument.    */
/* ============================================================ */

drop function if exists public.void_supplier_payment(uuid, text);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 6. repair_supplier_grn_ledger_postings                            */
/* ============================================================ */

drop function if exists public.repair_supplier_grn_ledger_postings(uuid);

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
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 7. get_supplier_ledger_ap_balance - security invoker, RLS on      */
/*    clinic_ledger_entries/clinic_ledger_transactions still governs */
/*    visibility beneath the explicit p_clinic_id filter, same        */
/*    reasoning as 0058's read RPCs.                                  */
/* ============================================================ */

drop function if exists public.get_supplier_ledger_ap_balance(uuid);

create or replace function public.get_supplier_ledger_ap_balance(p_clinic_id uuid, p_supplier_id uuid)
returns numeric
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(sum(e.credit - e.debit), 0)
  from public.clinic_ledger_entries e
  join public.clinic_ledger_transactions t on t.id = e.transaction_id
  where t.supplier_id = p_supplier_id
    and t.clinic_id = p_clinic_id
    and e.account_id = (
      select ls.accounts_payable_account_id from public.clinic_ledger_settings ls
      where ls.clinic_id = p_clinic_id
    );
$$;

grant execute on function public.get_supplier_ledger_ap_balance(uuid, uuid) to authenticated;

/* ============================================================ */
/* 8. create_staff_invitation - the same defect without an explicit  */
/*    "limit 1": a bare select-into over a multi-row result silently */
/*    keeps an arbitrary row with no ORDER BY.                        */
/* ============================================================ */

drop function if exists public.create_staff_invitation(text, text, text, text);

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
  where auth_user_id = v_uid and clinic_id = p_clinic_id;

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

/* ============================================================ */
/* 9. resend_staff_invitation - same defect; also adds an explicit   */
/*    null-clinic guard, since "no matching row for this p_clinic_id"*/
/*    is now a real, reachable outcome that the old code (which      */
/*    always found *some* clinic for anyone linked to at least one)  */
/*    never had to handle explicitly.                                 */
/* ============================================================ */

drop function if exists public.resend_staff_invitation(uuid, text);

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
  where auth_user_id = v_uid and clinic_id = p_clinic_id;

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
