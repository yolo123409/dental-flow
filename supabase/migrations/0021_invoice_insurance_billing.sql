-- ============================================================
-- Insurance Management V1 - Phase D: invoice-level billing method +
-- insurance provider.
--
-- clinic_invoices has no payment_method column today - payment method
-- lives on the separate clinic_payments table (actual money received,
-- possibly across several payments over time; set only inside
-- recordPayment()/RecordPaymentModal.tsx - Cash/M-Pesa/Card/Bank
-- Transfer, untouched by this migration). The two new columns here are a
-- different concept: "billing arrangement" - who/how this invoice is
-- being billed - chosen once at invoice-creation time, independent of
-- how/when money actually arrives.
--
-- Purely additive: two new nullable columns + a new index + two new
-- CHECK constraints + a new trigger. No existing column, RLS policy, or
-- clinic_payments logic is touched.
-- ============================================================

alter table public.clinic_invoices
  add column if not exists payment_method text;

-- restrict, not set null: V1 never deletes master insurance_providers
-- rows, and restrict gives a clear FK-violation error rather than the
-- confusing CHECK-violation a `set null` would trigger against the
-- "insurance requires a provider" constraint below.
alter table public.clinic_invoices
  add column if not exists insurance_provider_id uuid
    references public.insurance_providers(id) on delete restrict;

create index if not exists idx_clinic_invoices_insurance_provider_id
  on public.clinic_invoices(insurance_provider_id);

alter table public.clinic_invoices
  drop constraint if exists clinic_invoices_payment_method_check;
alter table public.clinic_invoices
  add constraint clinic_invoices_payment_method_check
  check (payment_method is null or payment_method in ('Cash', 'M-Pesa', 'Card', 'Bank Transfer', 'Insurance'));

alter table public.clinic_invoices
  drop constraint if exists clinic_invoices_insurance_provider_requires_method;
alter table public.clinic_invoices
  add constraint clinic_invoices_insurance_provider_requires_method
  check (
    (payment_method = 'Insurance' and insurance_provider_id is not null)
    or (payment_method is distinct from 'Insurance' and insurance_provider_id is null)
  );

-- Cross-table check a CHECK constraint can't express: the provider must
-- actually be one this invoice's clinic currently accepts. Skips
-- re-validation on UPDATE when insurance_provider_id didn't change, so
-- editing an old invoice's notes/discount after the clinic later drops
-- that insurer doesn't retroactively break it - historical invoices must
-- keep showing their original insurer even after the clinic stops
-- accepting it (spec section 13).
create or replace function public.validate_clinic_invoice_insurance()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.insurance_provider_id is not distinct from old.insurance_provider_id then
    return new;
  end if;

  if new.insurance_provider_id is not null and not exists (
    select 1 from public.clinic_insurance_providers cip
    where cip.clinic_id = new.clinic_id
      and cip.insurance_provider_id = new.insurance_provider_id
  ) then
    raise exception 'This insurance provider is not accepted by this clinic';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_clinic_invoice_insurance on public.clinic_invoices;
create trigger trg_validate_clinic_invoice_insurance
  before insert or update on public.clinic_invoices
  for each row
  execute function public.validate_clinic_invoice_insurance();
