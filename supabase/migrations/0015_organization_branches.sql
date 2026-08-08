-- DentalFlow Enterprise, Phase 3: let an organization's CEO create branches
-- through the exact same bootstrap RPC independent clinics already use.
--
-- create_clinic_with_admin gains one new optional parameter,
-- p_organization_id. When null (every existing caller), behavior is
-- completely unchanged - same signature-evolution pattern already used for
-- create_staff_invitation in 0008 (drop the old arity, recreate with a new
-- trailing default param, so PostgREST resolves to exactly one candidate
-- function and existing named-arg calls from services/clinic.ts keep
-- working without any client-side change).
--
-- When p_organization_id IS provided, the caller must be that
-- organization's CEO (public.is_organization_ceo, from 0014) - this is the
-- only new authorization check. Everything else (the "already linked to a
-- clinic" guard, clinic_settings/clinic_roles seeding, the caller's own
-- Owner clinic_users row) is identical to the independent-clinic path,
-- because an organization branch genuinely IS a normal DentalFlow clinic
-- internally, just with organization_id set.
--
-- Deliberately NOT relaxing the "already linked to a clinic" guard here:
-- an account that's already an independent clinic Owner cannot also become
-- an org's first-branch Owner in this phase. Loosening clinic_users to
-- allow multiple rows per auth user is Phase 5's work (branch switching
-- for org members visiting branches they didn't personally create), not
-- this one - this guard is what keeps that scope boundary real rather than
-- accidental.
--
-- Safe to re-run: drop function if exists + create or replace, matching
-- every other migration in this folder.

drop function if exists public.create_clinic_with_admin(text, text, text, text);

create or replace function public.create_clinic_with_admin(
  p_clinic_name text,
  p_owner_full_name text,
  p_owner_email text,
  p_owner_phone text default null,
  p_organization_id uuid default null
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

  if p_organization_id is not null and not public.is_organization_ceo(p_organization_id) then
    raise exception 'Only the organization''s CEO can create a branch for it';
  end if;

  insert into public.clinics (name, email, plan, organization_id)
  values (trim(p_clinic_name), p_owner_email, 'free', p_organization_id)
  returning id into v_clinic_id;

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

grant execute on function public.create_clinic_with_admin(text, text, text, text, uuid)
  to authenticated;
