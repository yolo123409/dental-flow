-- Appointment Completion -> Billing (Phase B/C), Issue 1's second half:
-- createInvoice() (services/billing.ts) has a real, PRE-EXISTING race,
-- confirmed by reading it in full, not assumed. It does three separate,
-- non-atomic round trips - INSERT clinic_invoices, INSERT
-- clinic_invoice_items, then an UNCONDITIONAL
-- `update clinic_charges set status = 'Invoiced' ... where id in (...)`
-- with no `where status = 'Pending'` guard. clinic_invoice_items doesn't
-- even reference clinic_charges.id, so nothing in the schema stops two
-- concurrent createInvoice() calls from both successfully invoicing the
-- SAME charge - two invoices, two ledger postings, double revenue/AR for
-- one treatment. This already affects every existing caller (the Billing
-- Control Center, the Treatment Plan "Create Invoice" button) - completion
-- -triggered billing just makes it far more likely to be hit. Fixed here
-- for all of them at once, not narrowly for the new path.
--
-- THE FIX: the same shape as record_payment/apply_customer_credit
-- (migrations 0102/0103) - one atomic function that locks every charge
-- being invoiced with `for update` (stable id order, so two overlapping
-- concurrent calls can never deadlock each other) before checking
-- anything, then does the insert-items-mark-invoiced sequence in the same
-- transaction. A concurrent second caller blocks on the lock, then - once
-- unblocked - reads the ALREADY-Invoiced status and is rejected with a
-- clear error naming the treatment, instead of silently creating a second
-- invoice.
--
-- SECURITY DEFINER, matching record_payment/apply_customer_credit/
-- grant_customer_credit exactly (not create_treatment_with_teeth's
-- invoker style): SECURITY DEFINER bypasses RLS, so - exactly like those
-- three existing RPCs - this function must and does re-implement both the
-- clinic-membership check and the role check itself via _caller_role(),
-- rather than relying on RLS to have already scoped the SELECT. This is
-- also what makes clinic/branch isolation exact here: v_clinic_id is
-- derived from the locked charge rows themselves, not from a separately
-- fetched "current clinic" value that could be stale after a branch
-- switch - a Branch A member can only ever lock/invoice Branch A charges,
-- and any charge whose clinic_id doesn't match every other locked charge
-- is rejected outright.
--
-- Role check reuses the exact existing "billing" permission holders
-- (Owner/Admin/Receptionist, lib/permissions.ts) - the same set
-- trg_guard_role_invoices/trg_guard_role_invoice_items (migration 0097)
-- already enforce on the raw tables, and the same set services/billing.ts
-- createInvoice()'s own assertPermission("billing") already enforces at
-- the application layer, kept unchanged below it. No new permission
-- invented; a Dentist is rejected here exactly as they already are today.
--
-- Preserves EXISTING behavior exactly - this is not a new billing engine:
-- invoice numbering, tax/VAT snapshot, currency, discount, and totals are
-- still computed in TypeScript (calculateInvoiceTotals,
-- generateInvoiceNumber, getClinicSettings) exactly as before and passed
-- in already-computed; this function only makes the multi-table write
-- atomic. Every existing trigger still fires unchanged: auth.uid() inside
-- trg_guard_role_invoices/trg_guard_role_invoice_items still reflects the
-- true calling user regardless of SECURITY DEFINER (the same established
-- property migration 0100/0102's RPCs already rely on), and
-- trg_post_invoice_ledger (migration 0043) still fires on this function's
-- plain `insert into clinic_invoices` exactly as it does for any other
-- caller - ledger posting is completely unchanged.
--
-- One deliberate, minimal tightening: treatment_name/unit_price for each
-- invoice_item are now read fresh from the locked clinic_charges row
-- inside this transaction, rather than trusted from the caller-supplied
-- ChargeSelection snapshot the old client code used. In every real
-- (non-racing) call this is the exact same value the caller just read
-- moments earlier - this only matters, correctly, in the race case
-- atomicity requires closing.
--
-- services/billing.ts#createInvoice() becomes a thin wrapper around this
-- RPC (this same phase) - same signature, same callers, unchanged
-- behavior on the success path.

create or replace function public.create_invoice_from_charges(
  p_charge_ids uuid[],
  p_patient_id uuid,
  p_invoice_number text,
  p_subtotal numeric,
  p_discount numeric,
  p_tax numeric,
  p_total numeric,
  p_notes text default null,
  p_payment_method text default null,
  p_insurance_provider_id uuid default null,
  p_tax_enabled boolean default false,
  p_tax_name text default '',
  p_tax_rate numeric default 0,
  p_tax_inclusive boolean default false,
  p_tax_registration_number text default null
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
  v_charge record;
  v_locked_count integer := 0;
  v_invoice public.clinic_invoices;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_charge_ids is null or array_length(p_charge_ids, 1) is null then
    raise exception 'No charges were selected to invoice.';
  end if;

  if p_payment_method = 'Insurance' and p_insurance_provider_id is null then
    raise exception 'Select an insurance provider to bill this invoice through insurance.';
  end if;

  select clinic_id into v_clinic_id
  from public.clinic_charges
  where id = p_charge_ids[1];

  if v_clinic_id is null then
    raise exception 'Charge % was not found.', p_charge_ids[1];
  end if;

  v_role := public._caller_role(v_clinic_id);
  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to create an invoice.', coalesce(v_role, 'none');
  end if;

  -- Lock every charge in a stable order BEFORE checking anything - this
  -- is the actual fix. A concurrent second caller targeting an
  -- overlapping set of charges blocks here until this transaction
  -- commits or rolls back, then sees the fresh (already-Invoiced) status.
  for v_charge in
    select * from public.clinic_charges
    where id = any(p_charge_ids)
    order by id
    for update
  loop
    v_locked_count := v_locked_count + 1;

    if v_charge.clinic_id is distinct from v_clinic_id then
      raise exception 'All selected charges must belong to the same clinic.';
    end if;

    if v_charge.status <> 'Pending' then
      raise exception 'Treatment "%" has already been invoiced.', v_charge.treatment_name;
    end if;
  end loop;

  if v_locked_count <> array_length(p_charge_ids, 1) then
    raise exception 'One or more selected charges were not found.';
  end if;

  insert into public.clinic_invoices (
    clinic_id, patient_id, invoice_number, subtotal, discount, tax, total,
    amount_paid, balance, status, notes, payment_method, insurance_provider_id,
    tax_enabled, tax_name, tax_rate, tax_inclusive, tax_registration_number
  ) values (
    v_clinic_id, p_patient_id, p_invoice_number, p_subtotal, p_discount, p_tax, p_total,
    0, p_total, 'Unpaid', p_notes,
    p_payment_method,
    case when p_payment_method = 'Insurance' then p_insurance_provider_id else null end,
    p_tax_enabled, p_tax_name, p_tax_rate, p_tax_inclusive, p_tax_registration_number
  )
  returning * into v_invoice;

  insert into public.clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price)
  select v_invoice.id, cc.treatment_name, 1, cc.amount, cc.amount
  from public.clinic_charges cc
  where cc.id = any(p_charge_ids);

  update public.clinic_charges
  set status = 'Invoiced', invoice_id = v_invoice.id
  where id = any(p_charge_ids);

  return v_invoice;
end;
$$;

grant execute on function public.create_invoice_from_charges(
  uuid[], uuid, text, numeric, numeric, numeric, numeric, text, text, uuid, boolean, text, numeric, boolean, text
) to authenticated;
