-- ============================================================
-- Insurance Management V1 - follow-up: Record Payment did not know about
-- insurance at all (RecordPaymentModal's dropdown was hardcoded to the
-- original 4 methods, never touched by migrations 0020/0021).
--
-- This distinguishes two separate concepts, per the same architecture
-- 0021 already established at the invoice level:
--   clinic_invoices.payment_method/insurance_provider_id - WHO IS
--     RESPONSIBLE for the invoice (the billing arrangement, chosen once).
--   clinic_payments.payment_method/insurance_provider_id (new here) -
--     HOW EACH INDIVIDUAL PAYMENT was actually received. An invoice can
--     have several clinic_payments rows over time (e.g. one Insurance
--     payment for KES 15,000 + one M-Pesa payment for a KES 5,000
--     patient copay) - each needs its own record of how/whether an
--     insurer was involved, independent of the invoice's own
--     payment_method.
--
-- Purely additive: one new nullable column + index + two validations,
-- mirroring 0021 exactly. No existing column, RLS policy, or the
-- recordPayment() balance/status calculation is touched - amount_paid/
-- balance/status already correctly accumulate across multiple payments
-- regardless of payment_method, so partial-insurance-then-copay already
-- works once the provider can be recorded per payment.
--
-- Deliberately NOT adding a full enum CHECK on clinic_payments.payment_method
-- (unlike clinic_invoices) - that column has run unconstrained since
-- before this repo's migration history and its exact historical values
-- can't be verified from here; only the new insurance-specific
-- constraint is added, which is provably safe for every existing row
-- (any payment_method other than the literal string 'Insurance' already
-- satisfies it, and insurance_provider_id is a brand-new column that
-- defaults to null on every existing row).
-- ============================================================

alter table public.clinic_payments
  add column if not exists insurance_provider_id uuid
    references public.insurance_providers(id) on delete restrict;

create index if not exists idx_clinic_payments_insurance_provider_id
  on public.clinic_payments(insurance_provider_id);

alter table public.clinic_payments
  drop constraint if exists clinic_payments_insurance_provider_requires_method;
alter table public.clinic_payments
  add constraint clinic_payments_insurance_provider_requires_method
  check (
    (payment_method = 'Insurance' and insurance_provider_id is not null)
    or (payment_method is distinct from 'Insurance' and insurance_provider_id is null)
  );

-- Cross-table check a CHECK constraint can't express: the provider must
-- be one this payment's clinic currently accepts. Same skip-on-unrelated-
-- update behavior as clinic_invoices' trigger (0021), so editing/voiding
-- an old payment for unrelated reasons never retroactively breaks it.
create or replace function public.validate_clinic_payment_insurance()
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

drop trigger if exists trg_validate_clinic_payment_insurance on public.clinic_payments;
create trigger trg_validate_clinic_payment_insurance
  before insert or update on public.clinic_payments
  for each row
  execute function public.validate_clinic_payment_insurance();
