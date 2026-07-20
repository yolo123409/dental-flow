-- Multi-tenant onboarding: clinic creation, default roles/settings, and
-- tenant-isolation fixes for tables that were missing clinic_id or RLS.
--
-- SECURITY NOTE: as of writing, `appointments` and `dentists` are readable
-- by the public anon key with NO authentication at all. This migration
-- closes that gap. Apply it as soon as possible, independent of the rest
-- of the onboarding feature.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE
-- / DROP POLICY IF EXISTS).

-- ============================================================
-- 1. clinics: add a future-proof plan field (free-only for now)
-- ============================================================

alter table public.clinics
  add column if not exists plan text default 'free';

-- ============================================================
-- 2. clinic_settings: add the default-settings columns needed
--    for onboarding (timezone, appointment duration, hours, reminders).
--    currency/country already exist on this table.
-- ============================================================

alter table public.clinic_settings
  add column if not exists timezone text default 'Africa/Nairobi',
  add column if not exists default_appointment_duration integer default 30,
  add column if not exists clinic_hours jsonb default '{
    "monday":    {"open": "08:00", "close": "17:00", "closed": false},
    "tuesday":   {"open": "08:00", "close": "17:00", "closed": false},
    "wednesday": {"open": "08:00", "close": "17:00", "closed": false},
    "thursday":  {"open": "08:00", "close": "17:00", "closed": false},
    "friday":    {"open": "08:00", "close": "17:00", "closed": false},
    "saturday":  {"open": "09:00", "close": "13:00", "closed": false},
    "sunday":    {"open": "09:00", "close": "13:00", "closed": true}
  }'::jsonb,
  add column if not exists reminder_settings jsonb default '{
    "enabled": true,
    "channel": "email",
    "hours_before": 24
  }'::jsonb;

-- ============================================================
-- 3. clinic_roles: per-clinic seeded roles, extensible later.
--    Note: clinic_users.role stays a plain text column matching these
--    names ("Admin"/"Dentist"/"Receptionist") so the existing runtime
--    permission check in lib/permissions.ts keeps working unchanged.
-- ============================================================

create table if not exists public.clinic_roles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

alter table public.clinic_roles enable row level security;

drop policy if exists "clinic_roles_select_own_clinic" on public.clinic_roles;
create policy "clinic_roles_select_own_clinic"
  on public.clinic_roles for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_roles.clinic_id
    )
  );

-- ============================================================
-- 4. dentists: this table has NO clinic_id today - real gap, not just
--    a missing filter. There is exactly one clinic and 2 dentist rows
--    live today, so backfilling to that single clinic is unambiguous.
-- ============================================================

alter table public.dentists
  add column if not exists clinic_id uuid references public.clinics(id);

update public.dentists
  set clinic_id = (select id from public.clinics order by created_at asc limit 1)
  where clinic_id is null;

-- Only enforce NOT NULL once every row is backfilled (safe given the
-- update above; if you add more clinics before running this, re-check
-- for orphaned rows first).
do $$
begin
  if not exists (select 1 from public.dentists where clinic_id is null) then
    alter table public.dentists alter column clinic_id set not null;
  end if;
end $$;

alter table public.dentists enable row level security;

drop policy if exists "dentists_all_own_clinic" on public.dentists;
create policy "dentists_all_own_clinic"
  on public.dentists for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = dentists.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = dentists.clinic_id
    )
  );

-- ============================================================
-- 5. appointments: clinic_id already exists on this table, but it had
--    no RLS policy at all - readable by anyone with the anon key.
-- ============================================================

alter table public.appointments enable row level security;

drop policy if exists "appointments_all_own_clinic" on public.appointments;
create policy "appointments_all_own_clinic"
  on public.appointments for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = appointments.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = appointments.clinic_id
    )
  );

-- ============================================================
-- 6. clinics / clinic_settings: make sure members can read their own
--    clinic row and settings, and admins can update them. (Nothing in
--    the app reads `clinics` directly yet, but onboarding needs to
--    write it, and a future settings page will need to read/update it.)
-- ============================================================

alter table public.clinics enable row level security;

drop policy if exists "clinics_select_own" on public.clinics;
create policy "clinics_select_own"
  on public.clinics for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinics.id
    )
  );

drop policy if exists "clinics_update_admin_only" on public.clinics;
create policy "clinics_update_admin_only"
  on public.clinics for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinics.id
        and cu.role = 'Admin'
    )
  );

alter table public.clinic_settings enable row level security;

drop policy if exists "clinic_settings_select_own" on public.clinic_settings;
create policy "clinic_settings_select_own"
  on public.clinic_settings for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_settings.clinic_id
    )
  );

drop policy if exists "clinic_settings_update_admin_only" on public.clinic_settings;
create policy "clinic_settings_update_admin_only"
  on public.clinic_settings for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_settings.clinic_id
        and cu.role = 'Admin'
    )
  );

-- ============================================================
-- 7. Onboarding RPC: creates clinic + settings + default roles +
--    the calling user's own clinic_users row, atomically. SECURITY
--    DEFINER is required because a brand-new user has no clinic_users
--    row yet, so it can't satisfy any of the policies above on its own -
--    this function is the one deliberate, narrow bypass, and it only
--    ever acts on behalf of auth.uid() (never a caller-supplied id).
-- ============================================================

create or replace function public.create_clinic_with_admin(
  p_clinic_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null
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

  if exists (select 1 from public.clinic_users where auth_user_id = v_uid) then
    raise exception 'This account is already linked to a clinic';
  end if;

  if p_clinic_name is null or length(trim(p_clinic_name)) = 0 then
    raise exception 'Clinic name is required';
  end if;

  insert into public.clinics (name, email, plan)
  values (trim(p_clinic_name), p_owner_email, 'free')
  returning id into v_clinic_id;

  insert into public.clinic_settings (clinic_id, clinic_name, email)
  values (v_clinic_id, trim(p_clinic_name), p_owner_email);

  insert into public.clinic_roles (clinic_id, name, permissions, is_system)
  values
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
    'Admin', 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  return query select v_clinic_id, v_clinic_user_id;
end;
$$;

grant execute on function public.create_clinic_with_admin(text, text, text, text)
  to authenticated;
