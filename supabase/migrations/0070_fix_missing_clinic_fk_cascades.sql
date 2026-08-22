-- Production Readiness 2.0, Section 8. Every clinic-scoped table's
-- clinic_id -> public.clinics(id) foreign key uses ON DELETE CASCADE
-- (verified: 35 occurrences across the migration history). Exactly two
-- tables break that convention: dentists.clinic_id (0001_multi_tenant_
-- onboarding.sql) and attachments.clinic_id (0003_fix_patient_teeth_and_
-- attachments_isolation.sql). Both got their clinic_id column via a
-- retrofit `alter table ... add column ... references public.clinics(id)`
-- onto a pre-existing table rather than a fresh `create table`, and both
-- omitted the `on delete cascade` every other such column has - an
-- oversight, not a deliberate design choice, since nothing in the
-- architecture treats these two tables differently from any other
-- clinic-scoped table.
--
-- Net effect of the bug: deleting a clinic today leaves orphaned
-- dentists/attachments rows referencing a clinic_id that no longer
-- exists, instead of being removed along with the rest of that clinic's
-- data like every other table.
--
-- Postgres has no ALTER CONSTRAINT to change ON DELETE behavior in
-- place - the constraint must be dropped and recreated. This looks up
-- each table's actual (auto-generated) FK constraint name rather than
-- assuming it, so this is safe to run regardless of exactly what name
-- was assigned when the column was added.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as table_name
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.clinics'::regclass
      and c.conrelid in ('public.dentists'::regclass, 'public.attachments'::regclass)
      and a.attname = 'clinic_id'
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (clinic_id) references public.clinics(id) on delete cascade',
      r.table_name, r.conname
    );
  end loop;
end $$;
