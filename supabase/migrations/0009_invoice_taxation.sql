-- Per-clinic taxation.
--
-- Adds configurable tax settings to clinic_settings (enable/disable, name,
-- rate, inclusive-vs-exclusive pricing, registration number, invoice
-- footer note) and a matching snapshot of that config on clinic_invoices.
--
-- The snapshot columns on clinic_invoices are deliberate: an invoice always
-- renders its OWN tax_enabled/tax_name/tax_rate/tax_inclusive, never the
-- clinic's current live settings, so changing (or disabling) tax later
-- never alters how a past invoice displays or was totalled.
--
-- All new columns default to false/0/'VAT' at the DB level, so every
-- existing clinic_settings/clinic_invoices row is automatically treated as
-- "tax disabled" with zero tax - no backfill needed, nothing breaks.
--
-- Safe to re-run: add column if not exists, matching every other migration
-- in this folder. No RLS changes - these columns land on tables that
-- already have clinic-scoped policies (select/update use
-- `clinic_id = <table>.clinic_id` style checks that don't enumerate
-- columns), so the new columns inherit the existing access control as-is.

alter table public.clinic_settings
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_name text not null default 'VAT',
  add column if not exists tax_rate numeric(5, 2) not null default 0,
  add column if not exists prices_include_tax boolean not null default false,
  add column if not exists tax_registration_number text,
  add column if not exists invoice_footer_tax_note text;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_tax_rate_range;
alter table public.clinic_settings
  add constraint clinic_settings_tax_rate_range
  check (tax_rate >= 0 and tax_rate <= 100);

alter table public.clinic_invoices
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_name text not null default 'VAT',
  add column if not exists tax_rate numeric(5, 2) not null default 0,
  add column if not exists tax_inclusive boolean not null default false,
  add column if not exists tax_registration_number text;

alter table public.clinic_invoices
  drop constraint if exists clinic_invoices_tax_rate_range;
alter table public.clinic_invoices
  add constraint clinic_invoices_tax_rate_range
  check (tax_rate >= 0 and tax_rate <= 100);
