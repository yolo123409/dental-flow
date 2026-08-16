-- Cleanup: remove the three orphan clinics created while testing the
-- (since fully rolled back) multi-branch CEO-signup flow. Confirmed via a
-- read-only audit to contain zero patients, appointments, invoices,
-- expenses, inventory, ledger entries, or any other clinical/financial
-- data — only clinic_users, clinic_settings, and a single dentist row.
--
-- Scope is limited to exactly these three clinic IDs. No CASCADE is used
-- anywhere. All deletions and assertions run inside one transaction: any
-- assertion failure raises an exception, which aborts the transaction and
-- performs zero deletions.
--
-- Target clinics:
--   a8375c87-4984-49b6-a1eb-1e2790068668 (Utawala)
--   3e3550bf-84a4-4c76-8f0f-b8baae7d4f5a (Wetslands)
--   72d65f11-5da5-4ba1-9002-40a679e0c115 (Parklands)
--
-- Explicitly NOT touched: auth.users (either account), the
-- DentalFlow Demo Clinic (ed2d8fb6-3603-47bd-ac8e-061a324a489d) or any of
-- its data, and the unrelated staff_invitations row on that clinic.

begin;

do $migration$
declare
  target_clinics uuid[] := array[
    'a8375c87-4984-49b6-a1eb-1e2790068668',
    '3e3550bf-84a4-4c76-8f0f-b8baae7d4f5a',
    '72d65f11-5da5-4ba1-9002-40a679e0c115'
  ]::uuid[];

  utawala_id uuid := 'a8375c87-4984-49b6-a1eb-1e2790068668';
  control_clinic_id uuid := 'ed2d8fb6-3603-47bd-ac8e-061a324a489d';
  target_owner_id uuid := 'a5f4e13b-2016-4cdf-ad3b-8b446f2d4a50';

  v_count int;
  v_dentists_deleted int;
  v_settings_deleted int;
  v_users_deleted int;
  v_clinics_deleted int;
  r record;
begin

  ---------------------------------------------------------------------
  -- STEP 1: Defensive pre-deletion assertions.
  -- Any failure here raises an exception, aborting the whole
  -- transaction before a single row is deleted.
  ---------------------------------------------------------------------

  -- Exactly the 3 target clinics exist.
  select count(*) into v_count from public.clinics where id = any(target_clinics);
  if v_count <> 3 then
    raise exception 'Pre-check failed: expected 3 clinics rows for target IDs, found %', v_count;
  end if;

  -- Exactly 3 clinic_users rows, one per clinic, all Owner/Active,
  -- all belonging to the confirmed test account.
  select count(*) into v_count from public.clinic_users where clinic_id = any(target_clinics);
  if v_count <> 3 then
    raise exception 'Pre-check failed: expected 3 clinic_users rows for target clinics, found %', v_count;
  end if;

  select count(*) into v_count
  from public.clinic_users
  where clinic_id = any(target_clinics)
    and not (role = 'Owner' and status = 'Active' and auth_user_id = target_owner_id);
  if v_count <> 0 then
    raise exception 'Pre-check failed: % unexpected clinic_users rows for target clinics (role/status/owner mismatch) — aborting', v_count;
  end if;

  -- Exactly 3 clinic_settings rows, one per clinic.
  select count(*) into v_count from public.clinic_settings where clinic_id = any(target_clinics);
  if v_count <> 3 then
    raise exception 'Pre-check failed: expected 3 clinic_settings rows for target clinics, found %', v_count;
  end if;

  -- Exactly 1 dentist row, and only under Utawala.
  select count(*) into v_count from public.dentists where clinic_id = any(target_clinics);
  if v_count <> 1 then
    raise exception 'Pre-check failed: expected 1 dentists row for target clinics, found %', v_count;
  end if;

  select count(*) into v_count
  from public.dentists
  where clinic_id = any(target_clinics) and clinic_id <> utawala_id;
  if v_count <> 0 then
    raise exception 'Pre-check failed: dentist row found outside Utawala — aborting';
  end if;

  -- Every other clinic-scoped table (any base table in public with a
  -- clinic_id column, other than the four tables this migration touches)
  -- must contain zero rows for the target clinics. Discovered dynamically
  -- rather than hardcoded, so this check cannot miss a table.
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_tables t
      on t.schemaname = c.table_schema and t.tablename = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'clinic_id'
      and c.table_name not in ('clinics', 'clinic_users', 'clinic_settings', 'dentists')
  loop
    execute format('select count(*) from public.%I where clinic_id = any($1)', r.table_name)
      into v_count
      using target_clinics;

    if v_count <> 0 then
      raise exception 'Pre-check failed: % unexpected rows found in table % for target clinics — aborting, no deletions performed', v_count, r.table_name;
    end if;
  end loop;

  raise notice 'Pre-deletion assertions passed: target clinics contain only the audited records.';

  ---------------------------------------------------------------------
  -- STEP 2: Deletion, in dependency order. No CASCADE.
  ---------------------------------------------------------------------

  delete from public.dentists where clinic_id = any(target_clinics);
  get diagnostics v_dentists_deleted = row_count;

  delete from public.clinic_settings where clinic_id = any(target_clinics);
  get diagnostics v_settings_deleted = row_count;

  delete from public.clinic_users where clinic_id = any(target_clinics);
  get diagnostics v_users_deleted = row_count;

  delete from public.clinics where id = any(target_clinics);
  get diagnostics v_clinics_deleted = row_count;

  raise notice 'Deleted % dentists, % clinic_settings, % clinic_users, % clinics',
    v_dentists_deleted, v_settings_deleted, v_users_deleted, v_clinics_deleted;

  ---------------------------------------------------------------------
  -- STEP 3: Post-deletion verification — all four tables must now
  -- contain zero rows for the target clinic IDs.
  ---------------------------------------------------------------------

  select count(*) into v_count from public.dentists where clinic_id = any(target_clinics);
  if v_count <> 0 then
    raise exception 'Post-check failed: % dentists rows remain for target clinics', v_count;
  end if;

  select count(*) into v_count from public.clinic_settings where clinic_id = any(target_clinics);
  if v_count <> 0 then
    raise exception 'Post-check failed: % clinic_settings rows remain for target clinics', v_count;
  end if;

  select count(*) into v_count from public.clinic_users where clinic_id = any(target_clinics);
  if v_count <> 0 then
    raise exception 'Post-check failed: % clinic_users rows remain for target clinics', v_count;
  end if;

  select count(*) into v_count from public.clinics where id = any(target_clinics);
  if v_count <> 0 then
    raise exception 'Post-check failed: % clinics rows remain for target clinics', v_count;
  end if;

  ---------------------------------------------------------------------
  -- STEP 4: Guard rail — confirm the untouched account/clinic are
  -- still exactly as they were before this migration ran.
  ---------------------------------------------------------------------

  perform 1 from public.clinics where id = control_clinic_id;
  if not found then
    raise exception 'Safety check failed: DentalFlow Demo Clinic no longer exists — aborting';
  end if;

  select count(*) into v_count from public.patients where clinic_id = control_clinic_id;
  if v_count <> 34 then
    raise exception 'Safety check failed: expected 34 patients on DentalFlow Demo Clinic, found %', v_count;
  end if;

  select count(*) into v_count from public.appointments where clinic_id = control_clinic_id;
  if v_count <> 28 then
    raise exception 'Safety check failed: expected 28 appointments on DentalFlow Demo Clinic, found %', v_count;
  end if;

  select count(*) into v_count from public.clinic_invoices where clinic_id = control_clinic_id;
  if v_count <> 28 then
    raise exception 'Safety check failed: expected 28 invoices on DentalFlow Demo Clinic, found %', v_count;
  end if;

  raise notice 'All safety checks passed. 3 orphan multi-branch test clinics removed; DentalFlow Demo Clinic and all other data confirmed untouched.';

end $migration$;

commit;
