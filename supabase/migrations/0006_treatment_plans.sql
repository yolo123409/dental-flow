-- Treatment Plans module: the workflow between diagnosis (odontogram) and
-- billing. A patient has multiple plans; each plan has multiple items.
-- Follows the exact conventions already established in this schema:
-- uuid PK with gen_random_uuid(), clinic_id FK + NOT NULL + indexed,
-- app-level updated_at (no triggers, matching every other table here),
-- and the same clinic-membership EXISTS policy shape as every RLS policy
-- added in earlier migrations.

create table if not exists public.treatment_plans (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid references public.clinic_users(id) on delete set null,

  title text not null,
  notes text,

  -- Draft | Planned | In Progress | Completed | Cancelled
  status text not null default 'Draft',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.treatment_plan_items (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,
  treatment_plan_id uuid not null references public.treatment_plans(id) on delete cascade,

  procedure text not null,
  tooth_number integer,

  estimated_price numeric not null default 0,
  quantity integer not null default 1,
  notes text,

  -- Low | Medium | High
  priority text not null default 'Medium',

  -- Planned | In Progress | Completed | Cancelled
  status text not null default 'Planned',

  sort_order integer not null default 0,

  -- Set once this item has been turned into a billable clinic_charges row
  -- (see services/treatmentPlans.ts#billTreatmentPlanItems), so an item is
  -- never billed twice and the invoice system stays the single source of
  -- truth for money - this table only tracks clinical work.
  charge_id uuid references public.clinic_charges(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_treatment_plans_clinic_id on public.treatment_plans(clinic_id);
create index if not exists idx_treatment_plans_patient_id on public.treatment_plans(patient_id);

create index if not exists idx_treatment_plan_items_clinic_id on public.treatment_plan_items(clinic_id);
create index if not exists idx_treatment_plan_items_plan_id on public.treatment_plan_items(treatment_plan_id);
create index if not exists idx_treatment_plan_items_charge_id on public.treatment_plan_items(charge_id);

alter table public.treatment_plans enable row level security;

drop policy if exists "treatment_plans_all_own_clinic" on public.treatment_plans;
create policy "treatment_plans_all_own_clinic"
  on public.treatment_plans for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_plans.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_plans.clinic_id
    )
  );

alter table public.treatment_plan_items enable row level security;

drop policy if exists "treatment_plan_items_all_own_clinic" on public.treatment_plan_items;
create policy "treatment_plan_items_all_own_clinic"
  on public.treatment_plan_items for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_plan_items.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = treatment_plan_items.clinic_id
    )
  );
