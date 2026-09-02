-- Full-app audit fix C1 (Critical): create_invoice_from_charges locks
-- every selected charge and checks they all share the same clinic_id,
-- but never checks they belong to the patient the invoice is actually
-- being created for. The ONLY patient-match check anywhere in the whole
-- stack is client-side JS in InvoicePreviewModal ("select exactly one
-- patient's charges before confirming") - a courtesy, not a gate. Every
-- other money-moving RPC in this codebase re-derives/re-validates
-- identity server-side rather than trusting the caller; this is the one
-- exception. Confirmed via the live 0111 definition: the charge-locking
-- loop checks `v_charge.clinic_id is distinct from v_clinic_id` but never
-- compares `v_charge.patient_id` to `p_patient_id`.
--
-- Without this, any authenticated user calling the RPC directly (or any
-- future UI regression in the Billing Control Center's flat, all-patients
-- charge list) can produce a real invoice - real AR, real ledger revenue -
-- billed to one patient but containing another patient's treatment items.
--
-- Fix: add the exact same shape of check the clinic_id comparison already
-- uses, one line, inside the same existing loop. No signature change, no
-- drop needed - create or replace over the identical 16-arg signature from
-- migration 0111.
--
-- Safe to re-run: create or replace function, same signature.

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
  p_tax_registration_number text default null,
  p_due_date date default null
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
  v_terms_days integer;
  v_due_date date;
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

    -- Audit fix C1: every charge must belong to the patient this invoice
    -- is being created for - the client-side single-patient-selection
    -- check in InvoicePreviewModal is a courtesy, not a gate. Without
    -- this, a direct RPC call (or a future UI regression) could bill one
    -- patient for another patient's treatment.
    if v_charge.patient_id is distinct from p_patient_id then
      raise exception 'All selected charges must belong to the invoiced patient.';
    end if;

    if v_charge.status <> 'Pending' then
      raise exception 'Treatment "%" has already been invoiced.', v_charge.treatment_name;
    end if;
  end loop;

  if v_locked_count <> array_length(p_charge_ids, 1) then
    raise exception 'One or more selected charges were not found.';
  end if;

  -- Billing audit fix #2: a caller-supplied due date wins; otherwise
  -- derive one from this clinic's default payment terms (0 = due on
  -- receipt). Existing callers pass nothing, so behavior is unchanged
  -- for any clinic that hasn't raised its terms above the default.
  if p_due_date is not null then
    v_due_date := p_due_date;
  else
    select coalesce(s.default_payment_terms_days, 0) into v_terms_days
    from public.clinic_settings s where s.clinic_id = v_clinic_id;

    v_due_date := current_date + coalesce(v_terms_days, 0);
  end if;

  insert into public.clinic_invoices (
    clinic_id, patient_id, invoice_number, subtotal, discount, tax, total,
    amount_paid, balance, status, notes, payment_method, insurance_provider_id,
    tax_enabled, tax_name, tax_rate, tax_inclusive, tax_registration_number,
    due_date
  ) values (
    v_clinic_id, p_patient_id, p_invoice_number, p_subtotal, p_discount, p_tax, p_total,
    0, p_total, 'Unpaid', p_notes,
    p_payment_method,
    case when p_payment_method = 'Insurance' then p_insurance_provider_id else null end,
    p_tax_enabled, p_tax_name, p_tax_rate, p_tax_inclusive, p_tax_registration_number,
    v_due_date
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
  uuid[], uuid, text, numeric, numeric, numeric, numeric, text, text, uuid,
  boolean, text, numeric, boolean, text, date
) to authenticated;
