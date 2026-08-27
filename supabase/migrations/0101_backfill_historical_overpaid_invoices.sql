-- FIN-4.4: resolves the two historical overpaid invoices FIN-3.9's
-- Financial Health Center has tracked as known exceptions
-- (INV-00007/INV-00010), per explicit user decision after a corrected
-- audit (see FIN-4.4's report - the real gap is bigger than first
-- described: neither invoice has ANY ledger posting at all, not just a
-- missing payment-side posting).
--
-- One new ManualJournal entry per invoice, posting the full real
-- economic picture for the first time: the real cash received (split by
-- payment method, from clinic_payments - never fabricated), the real
-- revenue earned (invoice total), and the real excess reclassified into
-- the Customer Credits liability this same phase's migration 0100 added.
-- AR is not involved: since these entries are being posted today with
-- full knowledge that payment was received essentially immediately (both
-- invoices' payments landed the same day or next day), there is no real
-- receivable period to represent - going through AR would only add and
-- immediately remove the same amount.
--
-- Same dynamic-discovery, hard-guarded discipline as migrations
-- 0091/0092: every amount below is asserted against live data before
-- anything is written. If production has changed since this migration
-- was written (2026-08-27) such that any assertion fails, the whole
-- migration aborts with an explicit error rather than posting a wrong
-- number.
--
-- Never touches clinic_invoices.amount_paid/balance/status (already
-- correct - they reflect what was actually paid) or any existing ledger
-- row (there are none to touch for these two invoices).
--
-- Migration 0100's role-guard trigger on clinic_customer_credits requires
-- a real, authenticated clinic_users session for any INSERT - this
-- migration runs as an administrative script with no such session, so
-- the trigger is disabled for the two rows this migration itself
-- inserts and re-enabled immediately after, the same DISABLE/ENABLE
-- TRIGGER pattern scripts/backup/restore-database-test.mjs already uses
-- for data loading (USER triggers only - Postgres's own FK-enforcement
-- triggers are untouched either way).

alter table public.clinic_customer_credits disable trigger trg_guard_role_customer_credits;

do $$
declare
  v_clinic_id uuid;
  v_patient_id uuid;
  v_invoice_id uuid;
  v_total numeric;
  v_mpesa_paid numeric;
  v_cash_paid numeric;
  v_total_paid numeric;
  v_overpayment numeric;
  v_mpesa_account uuid;
  v_cash_account uuid;
  v_revenue_account uuid;
  v_customer_credit_account uuid;
  v_credit_id uuid;
  v_currency text;
begin
  /* ============================================================ */
  /* INV-00007 - total 57996.52, real payments 30000 M-Pesa +      */
  /*             28000 Cash = 58000, overpayment 3.48               */
  /* ============================================================ */

  select i.clinic_id, i.patient_id, i.id, i.total
  into v_clinic_id, v_patient_id, v_invoice_id, v_total
  from public.clinic_invoices i
  where i.invoice_number = 'INV-00007';

  if v_invoice_id is null then
    raise exception 'INV-00007 not found - aborting, nothing written.';
  end if;

  if exists (select 1 from public.clinic_ledger_transactions where reference_type = 'invoice' and reference_id = v_invoice_id) then
    raise exception 'INV-00007 already has a ledger posting - aborting, this migration is only safe to run once.';
  end if;

  select
    coalesce(sum(p.amount) filter (where p.payment_method = 'M-Pesa'), 0),
    coalesce(sum(p.amount) filter (where p.payment_method = 'Cash'), 0),
    coalesce(sum(p.amount), 0)
  into v_mpesa_paid, v_cash_paid, v_total_paid
  from public.clinic_payments p
  where p.invoice_id = v_invoice_id;

  if round(v_total, 2) != 57996.52 then
    raise exception 'INV-00007 total is % (expected 57996.52) - live data has changed, aborting.', v_total;
  end if;
  if round(v_mpesa_paid, 2) != 30000.00 or round(v_cash_paid, 2) != 28000.00 or round(v_total_paid, 2) != 58000.00 then
    raise exception 'INV-00007 payments are M-Pesa=% Cash=% Total=% (expected 30000.00/28000.00/58000.00) - live data has changed, aborting.', v_mpesa_paid, v_cash_paid, v_total_paid;
  end if;

  v_overpayment := round(v_total_paid - v_total, 2);
  if v_overpayment != 3.48 then
    raise exception 'INV-00007 computed overpayment is % (expected 3.48) - aborting.', v_overpayment;
  end if;

  select a.id into v_mpesa_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '1020';
  select a.id into v_cash_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '1000';
  select a.id into v_revenue_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '4000';
  select a.id into v_customer_credit_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '2200';
  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  if v_mpesa_account is null or v_cash_account is null or v_revenue_account is null or v_customer_credit_account is null then
    raise exception 'INV-00007: one or more required ledger accounts are missing for clinic % - aborting.', v_clinic_id;
  end if;

  perform public._post_ledger_transaction(
    v_clinic_id, '2026-07-31'::date, 'ManualJournal', 'invoice', v_invoice_id,
    'FIN-4.4 historical backfill: real cash received, revenue, and overpayment reclassification for INV-00007 (never posted at the time)',
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_mpesa_account, 'debit', 30000.00, 'credit', 0),
      jsonb_build_object('account_id', v_cash_account, 'debit', 28000.00, 'credit', 0),
      jsonb_build_object('account_id', v_revenue_account, 'debit', 0, 'credit', 57996.52),
      jsonb_build_object('account_id', v_customer_credit_account, 'debit', 0, 'credit', 3.48)
    ),
    v_patient_id, null, null, null
  );

  insert into public.clinic_customer_credits (
    clinic_id, patient_id, source_invoice_id, amount, remaining_amount, notes
  ) values (
    v_clinic_id, v_patient_id, v_invoice_id, 3.48, 3.48,
    'FIN-4.4 historical backfill: overpayment on INV-00007, posted for the first time (2026-08-27).'
  )
  returning id into v_credit_id;

  raise notice 'INV-00007 resolved: posted real revenue 57996.52, real cash 58000.00, credit % (id=%) for 3.48.', v_credit_id, v_credit_id;

  /* ============================================================ */
  /* INV-00010 - total 10000.00, real payments 5000 Cash + 6000     */
  /*             M-Pesa = 11000, overpayment 1000.00                */
  /* ============================================================ */

  select i.clinic_id, i.patient_id, i.id, i.total
  into v_clinic_id, v_patient_id, v_invoice_id, v_total
  from public.clinic_invoices i
  where i.invoice_number = 'INV-00010';

  if v_invoice_id is null then
    raise exception 'INV-00010 not found - aborting (INV-00007 above was already written and committed as part of this same statement only if the whole DO block succeeds - a raised exception here rolls back everything in this block, including INV-00007s postings above, since this entire migration file runs in one transaction).';
  end if;

  if exists (select 1 from public.clinic_ledger_transactions where reference_type = 'invoice' and reference_id = v_invoice_id) then
    raise exception 'INV-00010 already has a ledger posting - aborting.';
  end if;

  select
    coalesce(sum(p.amount) filter (where p.payment_method = 'M-Pesa'), 0),
    coalesce(sum(p.amount) filter (where p.payment_method = 'Cash'), 0),
    coalesce(sum(p.amount), 0)
  into v_mpesa_paid, v_cash_paid, v_total_paid
  from public.clinic_payments p
  where p.invoice_id = v_invoice_id;

  if round(v_total, 2) != 10000.00 then
    raise exception 'INV-00010 total is % (expected 10000.00) - live data has changed, aborting.', v_total;
  end if;
  if round(v_mpesa_paid, 2) != 6000.00 or round(v_cash_paid, 2) != 5000.00 or round(v_total_paid, 2) != 11000.00 then
    raise exception 'INV-00010 payments are M-Pesa=% Cash=% Total=% (expected 6000.00/5000.00/11000.00) - live data has changed, aborting.', v_mpesa_paid, v_cash_paid, v_total_paid;
  end if;

  v_overpayment := round(v_total_paid - v_total, 2);
  if v_overpayment != 1000.00 then
    raise exception 'INV-00010 computed overpayment is % (expected 1000.00) - aborting.', v_overpayment;
  end if;

  select a.id into v_mpesa_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '1020';
  select a.id into v_cash_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '1000';
  select a.id into v_revenue_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '4000';
  select a.id into v_customer_credit_account from public.clinic_ledger_accounts a where a.clinic_id = v_clinic_id and a.code = '2200';
  select cs.currency into v_currency from public.clinic_settings cs where cs.clinic_id = v_clinic_id;

  if v_mpesa_account is null or v_cash_account is null or v_revenue_account is null or v_customer_credit_account is null then
    raise exception 'INV-00010: one or more required ledger accounts are missing for clinic % - aborting.', v_clinic_id;
  end if;

  perform public._post_ledger_transaction(
    v_clinic_id, '2026-08-01'::date, 'ManualJournal', 'invoice', v_invoice_id,
    'FIN-4.4 historical backfill: real cash received, revenue, and overpayment reclassification for INV-00010 (never posted at the time)',
    coalesce(v_currency, 'KES'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash_account, 'debit', 5000.00, 'credit', 0),
      jsonb_build_object('account_id', v_mpesa_account, 'debit', 6000.00, 'credit', 0),
      jsonb_build_object('account_id', v_revenue_account, 'debit', 0, 'credit', 10000.00),
      jsonb_build_object('account_id', v_customer_credit_account, 'debit', 0, 'credit', 1000.00)
    ),
    v_patient_id, null, null, null
  );

  insert into public.clinic_customer_credits (
    clinic_id, patient_id, source_invoice_id, amount, remaining_amount, notes
  ) values (
    v_clinic_id, v_patient_id, v_invoice_id, 1000.00, 1000.00,
    'FIN-4.4 historical backfill: overpayment on INV-00010, posted for the first time (2026-08-27).'
  )
  returning id into v_credit_id;

  raise notice 'INV-00010 resolved: posted real revenue 10000.00, real cash 11000.00, credit % (id=%) for 1000.00.', v_credit_id, v_credit_id;
end $$;

alter table public.clinic_customer_credits enable trigger trg_guard_role_customer_credits;
