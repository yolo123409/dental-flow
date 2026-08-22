-- Production Readiness 2.0, Section 4 (live RLS/grants inventory) found 7
-- tables in the public schema with RLS completely disabled, zero policies,
-- and full anon+authenticated CRUD grants (the project-wide default):
-- invoices, orders, patient_files, payments, products, purchases, profiles.
--
-- None of these are created by any migration in this repo, and a
-- repo-wide grep confirms zero references from any DentalFlow service,
-- page, or component. They are not DentalFlow tables - `patient_files`
-- in particular is easily confused with the real, RLS-protected
-- `attachments` table + `patient-files` storage bucket that DentalFlow
-- actually uses, but is a distinct, unrelated leftover object (almost
-- certainly scaffold from a Supabase starter/demo template applied to
-- this project before DentalFlow's own schema was built out - the
-- products/profiles columns match a generic marketplace demo, not
-- anything in this codebase).
--
-- Live data confirmed via service-role introspection before this
-- migration was written: products has 1 demo row, profiles has 5 rows
-- with real full_name/email columns, the other 5 tables are empty.
-- All 7 were independently confirmed readable with the public anon key
-- (no authentication required) before this fix.
--
-- Since nothing in the app touches these tables, the correct minimal
-- fix is to close the hole without touching data: enable RLS with no
-- policies (default-deny for every non-owner role) and revoke the
-- standing anon/authenticated grants. This is a non-destructive lockdown,
-- not a schema change - if these tables turn out to be needed by some
-- process outside this repo, ask before dropping them; this migration
-- does not drop anything.

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'orders', 'patient_files', 'payments', 'products', 'purchases', 'profiles']
  loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
