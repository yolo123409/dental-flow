-- ============================================================
-- Insurance Management V1 - Phase B/C: master provider list, per-clinic
-- acceptance, and onboarding-time selection support.
--
-- Two new tables, purely additive - no existing table/RLS policy is
-- touched:
--   insurance_providers        - global master list (name + active flag)
--   clinic_insurance_providers - which providers each clinic accepts
--
-- create_clinic_with_admin gains a 6th, optional, trailing parameter
-- (p_insurance_provider_ids) so onboarding can seed a clinic's accepted
-- insurers atomically at signup time. Existing 5-param callers
-- (AddBranchModal.tsx, FirstBranchForm.tsx - organization feature,
-- currently on hold but unaffected) keep working unchanged since the new
-- param defaults to '{}'.
-- ============================================================

-- ============================================================
-- 1. insurance_providers - global master list. Selectable by name, never
--    per-clinic-owned. V1 has no UI to create new master providers (see
--    spec section 17) - only readable, seeded below, no insert/update/
--    delete policy for regular users.
-- ============================================================

create table if not exists public.insurance_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_insurance_providers_name_lower
  on public.insurance_providers (lower(name));

alter table public.insurance_providers enable row level security;

-- Readable by anon (not just authenticated): the signup form shows this
-- checklist to a brand-new visitor who has no session yet (they're
-- 'anon' until signUp() succeeds), and the list itself is non-sensitive
-- public data (insurer names only).
drop policy if exists "insurance_providers_select_authenticated" on public.insurance_providers;
drop policy if exists "insurance_providers_select_public" on public.insurance_providers;
create policy "insurance_providers_select_public"
  on public.insurance_providers for select
  to anon, authenticated
  using (true);

-- ============================================================
-- 2. clinic_insurance_providers - which providers a clinic currently
--    accepts. Standard clinic-scoped join table, mirroring
--    organization_user_branches (migration 0014). Read by any clinic
--    member (needed to populate the invoice Insurance Provider dropdown
--    for Receptionists too); write restricted to Owner/Admin, matching
--    this clinic's settings-permission philosophy (lib/permissions.ts).
-- ============================================================

create table if not exists public.clinic_insurance_providers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  insurance_provider_id uuid not null references public.insurance_providers(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, insurance_provider_id)
);

create index if not exists idx_clinic_insurance_providers_clinic_id
  on public.clinic_insurance_providers(clinic_id);

create index if not exists idx_clinic_insurance_providers_provider_id
  on public.clinic_insurance_providers(insurance_provider_id);

alter table public.clinic_insurance_providers enable row level security;

drop policy if exists "clinic_insurance_providers_select_own_clinic" on public.clinic_insurance_providers;
create policy "clinic_insurance_providers_select_own_clinic"
  on public.clinic_insurance_providers for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_insurance_providers.clinic_id
    )
  );

drop policy if exists "clinic_insurance_providers_insert_admin_only" on public.clinic_insurance_providers;
create policy "clinic_insurance_providers_insert_admin_only"
  on public.clinic_insurance_providers for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_insurance_providers.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

drop policy if exists "clinic_insurance_providers_delete_admin_only" on public.clinic_insurance_providers;
create policy "clinic_insurance_providers_delete_admin_only"
  on public.clinic_insurance_providers for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_insurance_providers.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

-- ============================================================
-- 3. Seed data - insurers commonly encountered by Kenyan dental clinics.
--    "Old Mutual" is deliberately omitted: it merged with UAP in the
--    Kenyan market, so only the current correct name (UAP Old Mutual) is
--    seeded, avoiding a near-duplicate. SHA (Social Health Authority,
--    Kenya's national insurer, replaced NHIF in 2024) is included as a
--    commonly-accepted payer at Kenyan dental clinics today - this is
--    just a selectable name, unrelated to any future SHA/eClaims API
--    integration (explicitly out of scope for V1).
-- ============================================================

insert into public.insurance_providers (name) values
  ('AAR Insurance'),
  ('APA Insurance'),
  ('Britam'),
  ('CIC Insurance'),
  ('Cigna'),
  ('First Assurance'),
  ('GA Insurance'),
  ('Heritage Insurance'),
  ('ICEA LION'),
  ('Jubilee Insurance'),
  ('Madison Insurance'),
  ('Minet'),
  ('Pacis Insurance'),
  ('Sanlam'),
  ('UAP Old Mutual'),
  ('SHA')
on conflict (lower(name)) do nothing;

-- ============================================================
-- 4. create_clinic_with_admin - new trailing p_insurance_provider_ids
--    param. Body otherwise identical to migration 0017's version; the
--    insurance insert happens right after v_clinic_id is available,
--    alongside the clinic_settings/clinic_roles/clinic_users inserts.
--    Invalid/inactive provider ids are silently skipped (via the exists()
--    filter) rather than failing the whole signup - a bad insurance
--    selection should never block account creation.
-- ============================================================

drop function if exists public.create_clinic_with_admin(text, text, text, text, uuid);

create or replace function public.create_clinic_with_admin(
  p_clinic_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null,
  p_organization_id uuid default null,
  p_insurance_provider_ids uuid[] default '{}'::uuid[]
)
returns table (clinic_id uuid, clinic_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_clinic_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_clinic_name is null or length(trim(p_clinic_name)) = 0 then
    raise exception 'Clinic name is required';
  end if;

  if p_organization_id is not null then
    if not public.is_organization_ceo(p_organization_id) then
      raise exception 'Only the organization''s CEO can create a branch for it';
    end if;
  else
    if exists (select 1 from public.clinic_users where auth_user_id = v_uid) then
      raise exception 'This account is already linked to a clinic';
    end if;
  end if;

  insert into public.clinics (name, email, plan, organization_id)
  values (trim(p_clinic_name), p_owner_email, 'free', p_organization_id)
  returning id into v_clinic_id;

  if p_insurance_provider_ids is not null and array_length(p_insurance_provider_ids, 1) > 0 then
    insert into public.clinic_insurance_providers (clinic_id, insurance_provider_id)
    select v_clinic_id, pid
    from unnest(p_insurance_provider_ids) as pid
    where exists (
      select 1 from public.insurance_providers ip
      where ip.id = pid and ip.active
    )
    on conflict (clinic_id, insurance_provider_id) do nothing;
  end if;

  insert into public.clinic_settings (clinic_id, clinic_name, email)
  values (v_clinic_id, trim(p_clinic_name), p_owner_email);

  insert into public.clinic_roles (clinic_id, name, permissions, is_system)
  values
    (v_clinic_id, 'Owner', '["*"]'::jsonb, true),
    (v_clinic_id, 'Admin', '["*"]'::jsonb, true),
    (v_clinic_id, 'Dentist',
      '["dashboard","patients","appointments","calendar","treatments","documents"]'::jsonb,
      true),
    (v_clinic_id, 'Receptionist',
      '["dashboard","patients","appointments","calendar","billing","payments"]'::jsonb,
      true);

  insert into public.clinic_users (
    clinic_id, full_name, email, phone, role, status, auth_user_id
  )
  values (
    v_clinic_id, p_owner_full_name, p_owner_email, p_owner_phone,
    'Owner', 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  return query select v_clinic_id, v_clinic_user_id;
end;
$$;

grant execute on function public.create_clinic_with_admin(text, text, text, text, uuid, uuid[])
  to authenticated;
