-- Billing audit fix #2: "Overdue" on the AR report has never actually
-- measured overdue - clinic_invoices has no due_date column at all, and
-- both AR implementations (services/accountsReceivable.ts and
-- services/billing.ts#getArSummary()) age every invoice from its
-- CREATION date instead. This migration adds a real due_date, computed
-- from a per-clinic payment-terms default, and backfills existing rows
-- non-destructively.
--
-- clinic_settings predates the migrations folder (only ALTERs exist on
-- it, e.g. 0001). clinic_invoices likewise predates it - this migration
-- only adds columns, exactly like every prior migration that has
-- touched either table.
--
-- Safe to re-run: add column if not exists, backfill only nulls,
-- create or replace function, create table if not exists.

/* ============================================================ */
/* 1. Per-clinic default payment terms                            */
/* ============================================================ */

alter table public.clinic_settings
  add column if not exists default_payment_terms_days integer not null default 0;

comment on column public.clinic_settings.default_payment_terms_days is
  'Days after invoice creation an invoice is due by default (0 = due on receipt). Used by create_invoice_from_charges() when no explicit due date is given.';

/* ============================================================ */
/* 2. due_date on clinic_invoices                                 */
/* ============================================================ */

alter table public.clinic_invoices
  add column if not exists due_date date;

-- Backfill: historical invoices are anchored to "due on receipt" (their
-- own creation date) - the same assumption the old creation-date-based
-- aging logic already implicitly made, just now as a real stored fact
-- instead of a hardcoded cutoff recomputed on every report render. Only
-- touches rows that don't already have one (idempotent re-run safe).
--
-- clinic_invoices has carried trg_guard_role_invoices (migration 0097)
-- since before this migration was written - it fires on every UPDATE and
-- requires a real, authenticated clinic_users session via auth.uid().
-- This migration runs as an administrative script with no such session,
-- so the trigger is disabled for this one backfill statement and
-- re-enabled immediately after - the same DISABLE/ENABLE TRIGGER pattern
-- migration 0101 already uses for its own administrative writes against
-- clinic_customer_credits' equivalent role-guard trigger.
alter table public.clinic_invoices disable trigger trg_guard_role_invoices;

update public.clinic_invoices
set due_date = created_at::date
where due_date is null;

alter table public.clinic_invoices enable trigger trg_guard_role_invoices;

/* ============================================================ */
/* 3. create_invoice_from_charges (0109): compute due_date from    */
/*    the clinic's terms when the caller doesn't supply one -       */
/*    backward compatible, existing callers pass nothing and get    */
/*    the same "due today" behavior as before this column existed.  */
/*                                                                    */
/*    Adding a 16th parameter changes this function's signature -   */
/*    `create or replace` only replaces a function with the exact   */
/*    same parameter types, so without an explicit drop first the    */
/*    old 15-arg version would keep existing as a stale, unreachable */
/*    overload rather than being replaced.                           */
/* ============================================================ */

drop function if exists public.create_invoice_from_charges(
  uuid[], uuid, text, numeric, numeric, numeric, numeric, text, text, uuid,
  boolean, text, numeric, boolean, text
);

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

/* ============================================================ */
/* 4. Balance-reminder activity log - mirrors clinic_whatsapp_    */
/*    reminders (0013) exactly: proves a reminder link was        */
/*    opened, never that it was sent/delivered/read. SELECT+       */
/*    INSERT only, on purpose - no update/delete policy.           */
/* ============================================================ */

create table if not exists public.clinic_billing_reminders (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  patient_id uuid not null
    references public.patients(id) on delete cascade,

  invoice_id uuid not null
    references public.clinic_invoices(id) on delete cascade,

  initiated_by uuid references public.clinic_users(id) on delete set null,

  channel text not null default 'whatsapp' check (channel = 'whatsapp'),

  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_billing_reminders_clinic_id
  on public.clinic_billing_reminders(clinic_id);

create index if not exists idx_clinic_billing_reminders_invoice_id
  on public.clinic_billing_reminders(invoice_id);

-- Explicit, defensive grant - see the identical comment in
-- 0113_financial_audit_log.sql for why this table needs it stated
-- outright rather than assumed from default privileges.
grant select, insert on public.clinic_billing_reminders to authenticated;

alter table public.clinic_billing_reminders enable row level security;

drop policy if exists "clinic_billing_reminders_select_own_clinic" on public.clinic_billing_reminders;
create policy "clinic_billing_reminders_select_own_clinic"
  on public.clinic_billing_reminders for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_billing_reminders.clinic_id
    )
  );

drop policy if exists "clinic_billing_reminders_insert_own_clinic" on public.clinic_billing_reminders;
create policy "clinic_billing_reminders_insert_own_clinic"
  on public.clinic_billing_reminders for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_billing_reminders.clinic_id
    )
  );
