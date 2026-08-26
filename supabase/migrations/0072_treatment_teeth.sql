-- Treatment <-> Teeth relationship - Phase A of the Treatment/Procedure
-- architecture redesign (see the architecture audit for full context).
--
-- treatment_plan_items.tooth_number currently supports only ONE tooth per
-- item, which is why the multi-tooth odontogram selection has to fall
-- back to creating several separate patient_teeth records instead of one
-- treatment applied to several teeth. This migration adds the missing
-- many-to-many relationship WITHOUT touching tooth_number, billing, or
-- any other existing table - Phase B will teach the UI/services to read
-- from this table. Nothing that reads or writes today changes.
--
-- Deliberately NOT touched by this migration: patient_teeth (and its own
-- treatment/treatment_status/estimated_cost fields plus saveTooth()'s
-- clinic_charges side effect), clinic_charges, clinic_invoices,
-- clinic_invoice_items, billTreatmentPlanItems(), createInvoice().

create table if not exists public.treatment_teeth (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  -- No independent life outside its parent item - deleting the item
  -- (already cascades from treatment_plans, see 0006_treatment_plans.sql)
  -- should remove its tooth associations too. This table has no relation
  -- to clinic_charges/clinic_invoices at all, so nothing here can ever
  -- cascade into a financial record.
  treatment_plan_item_id uuid not null references public.treatment_plan_items(id) on delete cascade,

  tooth_number integer not null check (tooth_number between 1 and 32),

  created_at timestamptz not null default now()
);

-- The same tooth cannot be attached to the same treatment item twice.
-- Also serves as the lookup index for "every tooth on this treatment"
-- (Phase B's primary read pattern) via its leftmost column.
create unique index if not exists uq_treatment_teeth_item_tooth
  on public.treatment_teeth (treatment_plan_item_id, tooth_number);

-- "Every treatment that has ever touched tooth N, scoped to one clinic" -
-- the reverse lookup - plus general clinic-scoped scans.
create index if not exists idx_treatment_teeth_clinic_tooth
  on public.treatment_teeth (clinic_id, tooth_number);

alter table public.treatment_teeth enable row level security;

-- Identical clinic-membership pattern as treatment_plan_items (0006),
-- patient_diagnosis_codes and patient_procedure_codes (0054) - every
-- clinic-scoped table in this schema uses this exact EXISTS check. Not
-- a new authorization model.
drop policy if exists "treatment_teeth_all_own_clinic" on public.treatment_teeth;
create policy "treatment_teeth_all_own_clinic"
  on public.treatment_teeth for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_teeth.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_teeth.clinic_id
    )
  );

/* ============================================================ */
/* Backfill from treatment_plan_items.tooth_number               */
/* ============================================================ */
-- tooth_number itself is left completely untouched on
-- treatment_plan_items - it remains the compatibility field until every
-- consumer has migrated to reading treatment_teeth instead.

-- Report (never silently repair) any pre-existing tooth_number values
-- outside the valid range - those rows are intentionally excluded from
-- the backfill below rather than coerced.
do $$
declare
  v_out_of_range_count integer;
begin
  select count(*) into v_out_of_range_count
  from public.treatment_plan_items
  where tooth_number is not null
    and tooth_number not between 1 and 32;

  if v_out_of_range_count > 0 then
    raise notice
      'treatment_teeth backfill: % treatment_plan_items row(s) have a tooth_number outside 1-32 and were intentionally NOT backfilled - investigate separately, no existing data was modified.',
      v_out_of_range_count;
  end if;
end $$;

-- Idempotent (ON CONFLICT against the unique index above), so this is
-- safe to re-run and safe if some rows already exist.
insert into public.treatment_teeth (clinic_id, treatment_plan_item_id, tooth_number)
select tpi.clinic_id, tpi.id, tpi.tooth_number
from public.treatment_plan_items tpi
where tpi.tooth_number is not null
  and tpi.tooth_number between 1 and 32
on conflict (treatment_plan_item_id, tooth_number) do nothing;

-- Self-verifying: fails the migration loudly if the backfill didn't
-- fully account for every in-range source row - a sign of a bug in this
-- migration, not of pre-existing data, since exactly one row is expected
-- per eligible treatment_plan_items record.
do $$
declare
  v_expected_count integer;
  v_actual_count integer;
begin
  select count(*) into v_expected_count
  from public.treatment_plan_items
  where tooth_number is not null
    and tooth_number between 1 and 32;

  select count(*) into v_actual_count
  from public.treatment_teeth tt
  join public.treatment_plan_items tpi
    on tpi.id = tt.treatment_plan_item_id
   and tpi.tooth_number = tt.tooth_number;

  if v_actual_count < v_expected_count then
    raise exception
      'treatment_teeth backfill incomplete: expected % row(s) matching treatment_plan_items.tooth_number, found %',
      v_expected_count, v_actual_count;
  end if;

  raise notice 'treatment_teeth backfill: % row(s) backfilled from treatment_plan_items.tooth_number.', v_actual_count;
end $$;
