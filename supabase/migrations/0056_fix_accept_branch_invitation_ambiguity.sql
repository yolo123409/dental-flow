-- Fixes a confirmed, reproducible bug in accept_branch_invitation
-- (migration 0055, already applied): "column reference \"organization_id\"
-- is ambiguous" (42702), surfaced during live Phase 4 testing the first
-- time this function was actually exercised end-to-end (earlier phases
-- only ever seeded clinic_users/organization_users directly via service
-- role to test the read side, since branch invitations didn't exist
-- yet).
--
-- Root cause, identical in shape to the same class of bug already fixed
-- once before in this codebase's history (see migration 0031's BUG 2,
-- switch_active_branch, from the earlier fully-reverted multi-branch
-- attempt): `returns table (organization_id uuid, clinic_id uuid,
-- clinic_user_id uuid, role text, full_name text)` implicitly declares
-- each of those names as an output variable in scope for the entire
-- function body, exactly like a declared PL/pgSQL variable. Three bare,
-- unqualified column references inside the body collide with those
-- names:
--
--   1. `select organization_id into v_organization_id from public.clinics
--      where id = v_invitation.clinic_id;` - organization_id ambiguous
--      against clinics.organization_id.
--   2. `where auth_user_id = v_uid and clinic_id = v_invitation.clinic_id`
--      (inside the "already have access to this branch" exists check) -
--      clinic_id ambiguous against clinic_users.clinic_id.
--   3. `select organization_id into v_existing_org_id from
--      public.organization_users where auth_user_id = v_uid;` -
--      organization_id ambiguous against organization_users.organization_id.
--
-- Only #1 had actually been hit at runtime (execution stops at the first
-- error), but #2 and #3 are equally broken and would have surfaced next -
-- all three are fixed here, not just the one that happened to error
-- first.
--
-- Fix: qualify every table-column reference above with its table's
-- alias, exactly the same remedy already used for switch_active_branch
-- in migration 0031. RETURNS TABLE output shape is completely
-- unchanged (still organization_id, clinic_id, clinic_user_id, role,
-- full_name) - services/staffInvitations.ts#acceptInvitation reads
-- these exact field names from the RPC response, so this must stay a
-- pure CREATE OR REPLACE with the same signature, never a drop/recreate.
--
-- Safe to re-run: create or replace function with an unchanged
-- signature and return type.

create or replace function public.accept_branch_invitation(p_token text)
returns table (
  organization_id uuid, clinic_id uuid, clinic_user_id uuid, role text, full_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_email text;
  v_invitation record;
  v_organization_id uuid;
  v_clinic_user_id uuid;
  v_existing_org_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invitation
  from public.staff_invitations si
  where si.token = p_token
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'This invitation has already been accepted';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'This invitation has expired';
  end if;

  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_caller_email = '' or v_caller_email <> lower(v_invitation.email) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  select c.organization_id into v_organization_id
  from public.clinics c
  where c.id = v_invitation.clinic_id;

  if v_organization_id is null then
    raise exception 'This invitation is not a branch invitation';
  end if;

  if exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = v_invitation.clinic_id
  ) then
    raise exception 'You already have access to this branch';
  end if;

  select ou.organization_id into v_existing_org_id
  from public.organization_users ou
  where ou.auth_user_id = v_uid;

  if v_existing_org_id is not null and v_existing_org_id <> v_organization_id then
    raise exception 'This account already belongs to a different organization';
  end if;

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id
  )
  values (
    v_invitation.clinic_id, v_invitation.full_name, v_invitation.email,
    v_invitation.role, 'Active', v_uid
  )
  returning id into v_clinic_user_id;

  if v_existing_org_id is null then
    insert into public.organization_users (
      organization_id, auth_user_id, role, active_clinic_id
    )
    values (
      v_organization_id, v_uid, 'Member', v_invitation.clinic_id
    );
  else
    -- Already an organization member (e.g. accepting a second/third
    -- branch) - never downgrade an existing CEO to Member, and only
    -- default active_clinic_id to the new branch if nothing was
    -- selected yet, so accepting a second branch doesn't silently
    -- switch a CEO/Member away from whatever branch they're currently
    -- looking at.
    update public.organization_users ou
    set active_clinic_id = coalesce(ou.active_clinic_id, v_invitation.clinic_id)
    where ou.auth_user_id = v_uid;
  end if;

  update public.staff_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return query select
    v_organization_id, v_invitation.clinic_id, v_clinic_user_id, v_invitation.role, v_invitation.full_name;
end;
$$;

grant execute on function public.accept_branch_invitation(text) to authenticated;
