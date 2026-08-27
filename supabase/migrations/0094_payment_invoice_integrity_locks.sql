-- FIN-3.5: close a live gap where posted financial source records
-- (clinic_payments, clinic_invoices) could be deleted or edited by ANY
-- authenticated clinic member directly via the Supabase client, with zero
-- database-level enforcement and no application code ever exercising or
-- expecting this - the app's own code never deletes or edits a payment,
-- and only ever updates an invoice's amount_paid/balance/status
-- (recordPayment(), services/billing.ts). Confirmed by reading every
-- write path in this codebase before writing this migration - no RPC and
-- no client call ever updates/deletes either table any other way.
--
-- WHY THIS MATTERS: the ledger triggers that post invoices/payments
-- (migration 0043) only fire on INSERT. Deleting or editing a row after
-- it posts leaves its ledger entry permanently orphaned - the exact
-- "deleting posted payments without reversal" / "editing posted payment
-- amounts without compensating entries" risks this phase's brief names
-- explicitly. clinic_payments.invoice_id is ON DELETE CASCADE from
-- clinic_invoices, so deleting one invoice would silently destroy every
-- payment against it too, compounding the orphaned-ledger-entry problem.
--
-- ALSO FOUND: clinic_payments and clinic_invoices each carry a live,
-- correctly-scoped RLS policy (clinic_payments_delete_own_clinic /
-- clinic_invoices_delete_own_clinic, etc.) alongside an older, differently
-- named policy (Payments Delete / Invoices Delete / Payments Update /
-- Invoices Update) whose USING clause compares clinic_users.id (a random
-- primary key) to auth.uid() - structurally broken (can never match a
-- real session) and therefore a functional no-op, not a live hole on its
-- own. Both the broken duplicates and the live delete policies are
-- removed here; nothing legitimate depends on either.
--
-- clinic_expenses has its own separate, already-partially-guarded UPDATE
-- policy (status = 'Paid' required, category/supplier validity enforced)
-- but does not yet block an amount change on a posted expense - that is
-- FIN-3.6's named scope ("editing posted expenses without reversal"), not
-- touched by this migration.
--
-- THE FIX:
--   1. Remove every DELETE policy from clinic_payments and
--      clinic_invoices - RLS default-denies with no policy present, so
--      neither table is deletable by any client role after this. Matches
--      how clinic_expenses already has no DELETE policy at all (Voided
--      status is the only "removal" concept anywhere in this schema).
--   2. Remove every UPDATE policy from clinic_payments - nothing
--      legitimate ever updates a payment after it's created, so UPDATE is
--      fully blocked too, the same way DELETE is.
--   3. clinic_invoices keeps its live UPDATE policy (recordPayment()
--      needs it) but gains a BEFORE UPDATE trigger that rejects any
--      change to a column OTHER than amount_paid/balance/status/
--      updated_at once the invoice already has a posted Invoice-type
--      ledger transaction - so recordPayment() keeps working exactly as
--      before, while every other field (total, tax, patient_id, etc.)
--      becomes locked the instant the invoice is posted. An invoice that
--      failed to post (e.g. missing account config, surfaced as a
--      reconciliation issue) is NOT locked - it can still be corrected
--      until it actually posts.
--
-- Nothing here touches any existing row's data, any grant beyond RLS
-- policies, or any table's structure.

/* ============================================================ */
/* 1. clinic_payments: remove DELETE and UPDATE entirely          */
/* ============================================================ */

drop policy if exists "Payments Delete" on public.clinic_payments;
drop policy if exists "clinic_payments_delete_own_clinic" on public.clinic_payments;
drop policy if exists "Payments Update" on public.clinic_payments;
drop policy if exists "clinic_payments_update_own_clinic" on public.clinic_payments;

/* ============================================================ */
/* 2. clinic_invoices: remove DELETE entirely, drop the dead      */
/*    duplicate UPDATE policy, keep the live one                  */
/* ============================================================ */

drop policy if exists "Invoices Delete" on public.clinic_invoices;
drop policy if exists "clinic_invoices_delete_own_clinic" on public.clinic_invoices;
drop policy if exists "Invoices Update" on public.clinic_invoices;

/* ============================================================ */
/* 3. clinic_invoices: lock every column except                  */
/*    amount_paid/balance/status/updated_at once posted           */
/* ============================================================ */

create or replace function public._trigger_guard_posted_invoice_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.clinic_ledger_transactions t
    where t.reference_type = 'invoice' and t.reference_id = OLD.id
  ) then
    if NEW.clinic_id is distinct from OLD.clinic_id
      or NEW.patient_id is distinct from OLD.patient_id
      or NEW.invoice_number is distinct from OLD.invoice_number
      or NEW.subtotal is distinct from OLD.subtotal
      or NEW.discount is distinct from OLD.discount
      or NEW.tax is distinct from OLD.tax
      or NEW.total is distinct from OLD.total
      or NEW.notes is distinct from OLD.notes
      or NEW.payment_method is distinct from OLD.payment_method
      or NEW.insurance_provider_id is distinct from OLD.insurance_provider_id
      or NEW.tax_enabled is distinct from OLD.tax_enabled
      or NEW.tax_name is distinct from OLD.tax_name
      or NEW.tax_rate is distinct from OLD.tax_rate
      or NEW.tax_inclusive is distinct from OLD.tax_inclusive
      or NEW.tax_registration_number is distinct from OLD.tax_registration_number
      or NEW.created_at is distinct from OLD.created_at
    then
      raise exception 'This invoice has already been posted to the ledger - only amount_paid, balance, and status may change after posting.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_posted_invoice_update on public.clinic_invoices;
create trigger trg_guard_posted_invoice_update
  before update on public.clinic_invoices
  for each row execute function public._trigger_guard_posted_invoice_update();
