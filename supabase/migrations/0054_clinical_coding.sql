-- Clinical Coding: ICD-10-CM diagnoses, CDT/CPT procedures, modifiers.
--
-- Phase 1 architecture per the earlier read-only inspection: one global,
-- extensible reference table (clinical_codes) plus two patient-linked
-- attachment tables (patient_diagnosis_codes, patient_procedure_codes)
-- plus one modifier join table. Entirely additive: no existing table
-- (patients, appointments, patient_teeth, patient_tooth_history,
-- treatment_plans, treatment_plan_items, clinic_charges,
-- clinic_invoices, clinic_invoice_items, clinic_ledger_*) is altered.
-- Coding is optional clinical metadata - it never creates a charge,
-- invoice, or ledger entry on its own, and nothing here writes to any
-- existing row.
--
-- code_system enforcement: rather than trusting client-supplied values,
-- a BEFORE INSERT/UPDATE trigger on each attachment table looks up the
-- referenced clinical_codes row's own code_system, copies it onto the
-- attachment row (so it can never go stale), and rejects the write if
-- it doesn't belong on that table - patient_diagnosis_codes only ever
-- accepts ICD-10-CM, patient_procedure_codes only ever accepts CDT or
-- CPT. This makes "ICD-10 cannot be saved as a procedure code" (and
-- vice versa) a real database invariant, not just an app-layer rule.
--
-- No data is seeded here. ICD-10-CM is public domain and could in
-- principle be seeded, but no authoritative dataset exists anywhere in
-- this project, and hand-typing official code/description text from
-- memory would be fabrication - explicitly out of scope. CDT is
-- copyrighted by the ADA and CPT by the AMA; neither may be bulk-
-- imported without a license, and none is imported here. This table
-- ships completely empty - see the implementation report for what that
-- means for testing.

create table if not exists public.clinical_codes (
  id uuid primary key default gen_random_uuid(),

  code_system text not null check (code_system in ('ICD-10-CM', 'CDT', 'CPT')),
  code text not null,
  short_description text not null,
  long_description text,
  category text,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_clinical_codes_system_code
  on public.clinical_codes (code_system, code);

create index if not exists idx_clinical_codes_system_active
  on public.clinical_codes (code_system, active);

alter table public.clinical_codes enable row level security;

-- Global reference data, same "readable by every authenticated user,
-- writable by no one through the app" pattern as insurance_providers
-- (0020) - seeding/maintenance happens out-of-band (a future migration
-- or a licensed-import tool), never through client writes.
drop policy if exists "clinical_codes_select_authenticated" on public.clinical_codes;
create policy "clinical_codes_select_authenticated"
  on public.clinical_codes for select
  to authenticated
  using (true);

/* ============================================================ */
/* patient_diagnosis_codes - ICD-10-CM only                      */
/* ============================================================ */

create table if not exists public.patient_diagnosis_codes (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  code_id uuid not null references public.clinical_codes(id) on delete restrict,

  -- Set by the trigger below from clinical_codes.code_system - never
  -- written directly by the application.
  code_system text not null,

  -- Tooth-specific attachment (Tooth Details / TreatmentForm). Null for
  -- a diagnosis that isn't tied to one specific tooth.
  tooth_number integer check (tooth_number is null or (tooth_number between 1 and 32)),

  -- Generic polymorphic attachment for future encounter types (e.g.
  -- appointment-level diagnoses) - kept for the extensibility the
  -- original inspection called for. Not populated by any UI in this
  -- phase; tooth_number covers every case this phase actually wires up.
  reference_type text,
  reference_id uuid,

  notes text,

  recorded_by uuid references public.clinic_users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_diagnosis_codes_patient_tooth
  on public.patient_diagnosis_codes (patient_id, tooth_number);

create index if not exists idx_patient_diagnosis_codes_clinic
  on public.patient_diagnosis_codes (clinic_id);

-- Prevents an accidental double-add of the exact same code to the exact
-- same tooth (e.g. a double click) - does not limit how many DIFFERENT
-- codes a tooth can have.
create unique index if not exists uq_patient_diagnosis_codes_patient_tooth_code
  on public.patient_diagnosis_codes (patient_id, tooth_number, code_id);

alter table public.patient_diagnosis_codes enable row level security;

drop policy if exists "patient_diagnosis_codes_all_own_clinic" on public.patient_diagnosis_codes;
create policy "patient_diagnosis_codes_all_own_clinic"
  on public.patient_diagnosis_codes for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_diagnosis_codes.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_diagnosis_codes.clinic_id
    )
  );

create or replace function public._enforce_diagnosis_code_system()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_system text;
begin
  select code_system into v_system from public.clinical_codes where id = new.code_id;

  if v_system is null then
    raise exception 'clinical_codes row % not found', new.code_id;
  end if;

  if v_system <> 'ICD-10-CM' then
    raise exception 'patient_diagnosis_codes only accepts ICD-10-CM codes (got %)', v_system;
  end if;

  new.code_system := v_system;
  return new;
end;
$$;

drop trigger if exists trg_enforce_diagnosis_code_system on public.patient_diagnosis_codes;
create trigger trg_enforce_diagnosis_code_system
  before insert or update on public.patient_diagnosis_codes
  for each row execute function public._enforce_diagnosis_code_system();

/* ============================================================ */
/* patient_procedure_codes - CDT (default) or CPT                */
/* ============================================================ */

create table if not exists public.patient_procedure_codes (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  code_id uuid not null references public.clinical_codes(id) on delete restrict,

  -- Set by the trigger below from clinical_codes.code_system - never
  -- written directly by the application. Will be 'CDT' or 'CPT'.
  code_system text not null,

  tooth_number integer check (tooth_number is null or (tooth_number between 1 and 32)),

  -- Set when this procedure code was recorded against a specific
  -- treatment plan item. That item's own charge_id/clinic_charges link
  -- (already existing, untouched by this migration) is how a coded
  -- procedure can eventually be traced to billing - this table itself
  -- never touches clinic_charges/clinic_invoice_items.
  treatment_plan_item_id uuid references public.treatment_plan_items(id) on delete cascade,

  reference_type text,
  reference_id uuid,

  notes text,

  recorded_by uuid references public.clinic_users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_procedure_codes_patient_tooth
  on public.patient_procedure_codes (patient_id, tooth_number);

create index if not exists idx_patient_procedure_codes_treatment_plan_item
  on public.patient_procedure_codes (treatment_plan_item_id);

create index if not exists idx_patient_procedure_codes_clinic
  on public.patient_procedure_codes (clinic_id);

create unique index if not exists uq_patient_procedure_codes_patient_tooth_plan_code
  on public.patient_procedure_codes (patient_id, tooth_number, treatment_plan_item_id, code_id);

alter table public.patient_procedure_codes enable row level security;

drop policy if exists "patient_procedure_codes_all_own_clinic" on public.patient_procedure_codes;
create policy "patient_procedure_codes_all_own_clinic"
  on public.patient_procedure_codes for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_procedure_codes.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_procedure_codes.clinic_id
    )
  );

create or replace function public._enforce_procedure_code_system()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_system text;
begin
  select code_system into v_system from public.clinical_codes where id = new.code_id;

  if v_system is null then
    raise exception 'clinical_codes row % not found', new.code_id;
  end if;

  if v_system not in ('CDT', 'CPT') then
    raise exception 'patient_procedure_codes only accepts CDT or CPT codes (got %)', v_system;
  end if;

  new.code_system := v_system;
  return new;
end;
$$;

drop trigger if exists trg_enforce_procedure_code_system on public.patient_procedure_codes;
create trigger trg_enforce_procedure_code_system
  before insert or update on public.patient_procedure_codes
  for each row execute function public._enforce_procedure_code_system();

/* ============================================================ */
/* patient_procedure_code_modifiers                              */
/* ============================================================ */

create table if not exists public.patient_procedure_code_modifiers (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  procedure_code_id uuid not null references public.patient_procedure_codes(id) on delete cascade,

  modifier_code text not null,
  modifier_description text,

  created_at timestamptz not null default now()
);

create index if not exists idx_patient_procedure_code_modifiers_procedure
  on public.patient_procedure_code_modifiers (procedure_code_id);

alter table public.patient_procedure_code_modifiers enable row level security;

drop policy if exists "patient_procedure_code_modifiers_all_own_clinic" on public.patient_procedure_code_modifiers;
create policy "patient_procedure_code_modifiers_all_own_clinic"
  on public.patient_procedure_code_modifiers for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_procedure_code_modifiers.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = patient_procedure_code_modifiers.clinic_id
    )
  );
