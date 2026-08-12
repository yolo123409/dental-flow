-- Corrects a deeper schema-drift finding than the first attempt at this
-- migration assumed (that version never successfully applied - it errored
-- on its own backfill step, so nothing from it persisted; this replaces it
-- entirely rather than layering a second migration on top).
--
-- ACTUAL LIVE SCHEMA (confirmed by inspecting the live database directly,
-- not guessed - see method below):
--
--   organization_users: id, organization_id, user_id, role, branch_access,
--     status, invited_by, created_at, updated_at.
--     NO full_name, NO email. Never has, on this database - contrary to
--     what migration 0014's tracked file describes. Identity is only ever
--     `user_id` (references auth.users(id)).
--
--   profiles: id, full_name, email, role, created_at.
--     EXISTS live, but is NOT DentalFlow's data: `role` values are things
--     like "customer" (unrelated to any DentalFlow role vocabulary), and
--     `full_name` is blank on every row sampled. This matches migration
--     0005's own audit comment, which already flagged `profiles` as an
--     unused legacy table "not referenced by any application code" -
--     that was correct and still is. It is NOT the fix, despite having the
--     right-shaped columns - do not join it for full_name.
--
--   clinic_users: id, full_name, email, phone, role, status, auth_user_id,
--     clinic_id, organization_user_id, created_at.
--     Has REAL, DentalFlow-populated full_name/email - written directly by
--     create_clinic_with_admin/switch_active_branch/accept_staff_invitation
--     from actual signup/invite form input. This is the reliable source
--     whenever a person has at least one row here (true for every CEO -
--     create_clinic_with_admin always creates one directly - and for any
--     org member who has ever switched into a branch).
--
--   auth.users: has `email` (authoritative) and `raw_user_meta_data`,
--     which CeoSignupForm.tsx/AcceptOrganizationInvitationForm.tsx already
--     populate with `pending_full_name` at signup time - this survives
--     indefinitely as user_metadata, so it's a reliable fallback for
--     someone who's never had a clinic_users row yet (e.g. a Partner/
--     Viewer who has never switched into any branch).
--
-- METHOD: since this environment has no direct Postgres/psql access, the
-- live schema was inspected via the Supabase service-role key against
-- PostgREST's own OpenAPI root (GET /rest/v1/), which enumerates every
-- exposed table's real columns - not information_schema (PostgREST
-- restricts exposed schemas to `public`, so information_schema itself
-- isn't queryable this way), and a handful of actual rows were read back
-- (service role bypasses RLS) to confirm organization_users.user_id really
-- does match profiles.id/clinic_users.auth_user_id for the same person.
--
-- ROOT CAUSE, now fully explained: migration 0014's tracked file declares
-- full_name/email on organization_users, and every RPC written since
-- (0014's create_organization_with_ceo, 0016's accept_organization_
-- invitation and create_organization_invitation, 0017/0031's
-- switch_active_branch, and this feature's own 0033) assumed those columns
-- exist and either read or wrote them directly. None of that ever matched
-- the live table. `create table if not exists` in 0014 was a no-op against
-- a table that already existed (same class of drift as 0031's organization_
-- invitations.email bug) - so these columns were never actually there, and
-- every one of those INSERT/SELECT statements has been silently broken
-- since Phase 2/4. This went unnoticed because a plain client `select("*")`
-- (services/organizations.ts) just omits missing keys with no error - it
-- only surfaces as a hard 42703 in code that references the column by name
-- inside a SQL statement, which is exactly what this feature's new RPCs
-- (and, it turns out, several pre-existing ones) do.
--
-- FIX: no schema change to organization_users at all - full_name/email are
-- NOT added there (would create a duplicate, drifting copy of data that's
-- already correctly owned by clinic_users/auth.users, which is exactly
-- what was asked not to do). Instead, one shared resolver function
-- (resolve_organization_user_identity) centralizes the fallback chain
-- (clinic_users -> auth signup metadata -> email local-part), and every
-- affected function - the ones this feature added AND the pre-existing
-- ones this investigation found were already broken - is amended via
-- `create or replace function` to use it instead of assuming a column that
-- was never there.
--
-- Out of scope for this fix (flagged, not silently left broken without
-- mention): services/organizations.ts#getCurrentOrganizationUser() and
-- #getOrganizationMembers() both still do a plain `select("*")` typed as
-- OrganizationUser (which declares full_name/email) - they will keep
-- silently returning undefined for those two fields, meaning the CEO's
-- name in the app header, BranchSwitcher, and the Organization
-- Overview/Settings pages' greetings are ALSO blank today, independent of
-- Team & Access. That's a pre-existing gap on already-shipped screens, not
-- something this migration touches - it would need its own pass through
-- the client-side OrganizationUser type and every consumer, which is
-- broader than the Team & Access scope this fix was scoped to.
--
-- Safe to re-run: every function below is `create or replace`, and the
-- resolver function has no side effects (stable, read-only).

-- ============================================================
-- resolve_organization_user_identity - the shared fallback chain. Not
-- part of the public API surface (revoked from PUBLIC, same convention as
-- log_organization_audit_event) - only ever called from inside another
-- SECURITY DEFINER function in this migration.
-- ============================================================

create or replace function public.resolve_organization_user_identity(p_user_id uuid)
returns table (full_name text, email text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_auth_email text;
  v_metadata_name text;
  v_clinic_name text;
begin
  select u.email, u.raw_user_meta_data ->> 'pending_full_name'
    into v_auth_email, v_metadata_name
  from auth.users u
  where u.id = p_user_id;

  select cu.full_name into v_clinic_name
  from public.clinic_users cu
  where cu.auth_user_id = p_user_id
  order by cu.created_at asc
  limit 1;

  return query select
    coalesce(
      nullif(v_clinic_name, ''),
      nullif(v_metadata_name, ''),
      split_part(coalesce(v_auth_email, ''), '@', 1)
    ),
    coalesce(v_auth_email, '');
end;
$$;

revoke all on function public.resolve_organization_user_identity(uuid) from public;

-- ============================================================
-- create_organization_with_ceo (0014) - the INSERT no longer lists
-- full_name/email (the column doesn't exist). p_owner_full_name is still
-- validated (ensures the signup form actually sent one) - it reaches
-- resolve_organization_user_identity's fallback chain indirectly, since
-- the client already puts it in auth signup metadata as pending_full_name
-- (CeoSignupForm.tsx, unchanged).
-- ============================================================

create or replace function public.create_organization_with_ceo(
  p_organization_name text,
  p_owner_full_name text,
  p_owner_email text
)
returns table (organization_id uuid, organization_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_organization_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.organization_users where user_id = v_uid) then
    raise exception 'This account is already linked to an organization';
  end if;

  if p_organization_name is null or length(trim(p_organization_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  if p_owner_full_name is null or length(trim(p_owner_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  insert into public.organizations (name, primary_owner_user_id)
  values (trim(p_organization_name), v_uid)
  returning id into v_organization_id;

  insert into public.organization_users (
    organization_id, user_id, role, branch_access, status, invited_by
  )
  values (
    v_organization_id, v_uid, 'CEO', 'all', 'Active', null
  )
  returning id into v_organization_user_id;

  return query select v_organization_id, v_organization_user_id;
end;
$$;

grant execute on function public.create_organization_with_ceo(text, text, text)
  to authenticated;

-- ============================================================
-- switch_active_branch (0017/0031) - v_org_user no longer carries
-- full_name/email (select * from organization_users doesn't have them).
-- Resolves identity separately when lazily provisioning a clinic_users
-- row. Everything else unchanged from 0031's version.
-- ============================================================

create or replace function public.switch_active_branch(p_clinic_id uuid)
returns table (clinic_id uuid, clinic_user_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
  v_org_user record;
  v_identity record;
  v_clinic_org_id uuid;
  v_new_role text;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select cu.* into v_existing
  from public.clinic_users cu
  where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;

  if found then
    return query select v_existing.clinic_id, v_existing.id, v_existing.role;
    return;
  end if;

  select * into v_org_user
  from public.organization_users
  where user_id = v_uid and status = 'Active';

  if v_org_user.id is null then
    raise exception 'You do not have access to this branch';
  end if;

  if v_org_user.role = 'Viewer' then
    raise exception 'Viewers do not have access to individual branch operations';
  end if;

  select c.organization_id into v_clinic_org_id
  from public.clinics c
  where c.id = p_clinic_id;

  if v_clinic_org_id is null or v_clinic_org_id <> v_org_user.organization_id then
    raise exception 'You do not have access to this branch';
  end if;

  if v_org_user.branch_access = 'selected' and not exists (
    select 1 from public.organization_user_branches oub
    where oub.organization_user_id = v_org_user.id and oub.clinic_id = p_clinic_id
  ) then
    raise exception 'You do not have access to this branch';
  end if;

  v_new_role := 'Admin';

  select * into v_identity from public.resolve_organization_user_identity(v_uid);

  insert into public.clinic_users (
    clinic_id, full_name, email, role, status, auth_user_id, organization_user_id
  )
  values (
    p_clinic_id, v_identity.full_name, v_identity.email, v_new_role, 'Active',
    v_uid, v_org_user.id
  )
  on conflict (auth_user_id, clinic_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    select cu.id into v_new_id
    from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id;
  end if;

  return query select p_clinic_id, v_new_id, v_new_role;
end;
$$;

grant execute on function public.switch_active_branch(uuid) to authenticated;

-- ============================================================
-- create_organization_invitation (0016/0033) - the two "already a member"
-- exists-checks now join auth.users for email instead of assuming
-- organization_users.email; the caller (CEO) identity lookup no longer
-- selects full_name/email off organization_users, resolving them via the
-- helper instead.
-- ============================================================

create or replace function public.create_organization_invitation(
  p_email text,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[],
  p_token text
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_org_id uuid;
  v_caller_org_user_id uuid;
  v_caller_full_name text;
  v_caller_email text;
  v_email text := lower(trim(p_email));
  v_invitation_id uuid;
  v_expires_at timestamptz;
  v_branch_id uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select organization_id, id into v_caller_org_id, v_caller_org_user_id
  from public.organization_users
  where user_id = v_uid and status = 'Active' and role = 'CEO';

  if v_caller_org_id is null then
    raise exception 'Only the organization''s CEO can invite members';
  end if;

  select full_name, email into v_caller_full_name, v_caller_email
  from public.resolve_organization_user_identity(v_uid);

  if p_role not in ('Partner', 'Manager', 'Viewer') then
    raise exception 'Invalid role';
  end if;

  if p_branch_access not in ('all', 'selected') then
    raise exception 'Invalid branch access';
  end if;

  if p_branch_access = 'selected'
     and (p_branch_ids is null or array_length(p_branch_ids, 1) is null) then
    raise exception 'Select at least one branch';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please provide a valid email address';
  end if;

  if exists (
    select 1
    from public.organization_users ou2
    join auth.users u on u.id = ou2.user_id
    where ou2.organization_id = v_caller_org_id and lower(u.email) = v_email
  ) then
    raise exception 'This person is already a member of this organization';
  end if;

  if exists (
    select 1
    from public.organization_users ou2
    join auth.users u on u.id = ou2.user_id
    where lower(u.email) = v_email
  ) then
    raise exception 'This email already belongs to a member of another organization';
  end if;

  delete from public.organization_invitations
  where organization_id = v_caller_org_id
    and lower(email) = v_email
    and accepted_at is null
    and organization_invitations.expires_at < now();

  if exists (
    select 1 from public.organization_invitations
    where organization_id = v_caller_org_id
      and lower(email) = v_email
      and accepted_at is null
  ) then
    raise exception 'An invitation is already pending for this email';
  end if;

  if p_branch_access = 'selected' then
    if exists (
      select 1
      from unnest(p_branch_ids) as bid
      left join public.clinics c
        on c.id = bid and c.organization_id = v_caller_org_id
      where c.id is null
    ) then
      raise exception 'One or more selected branches are invalid';
    end if;
  end if;

  v_expires_at := now() + interval '7 days';

  insert into public.organization_invitations (
    organization_id, email, role, branch_access, token, invited_by, expires_at
  )
  values (
    v_caller_org_id, v_email, p_role, p_branch_access, p_token,
    v_caller_org_user_id, v_expires_at
  )
  returning id into v_invitation_id;

  if p_branch_access = 'selected' then
    foreach v_branch_id in array p_branch_ids loop
      insert into public.organization_invitation_branches (invitation_id, clinic_id)
      values (v_invitation_id, v_branch_id);
    end loop;
  end if;

  perform public.log_organization_audit_event(
    v_caller_org_id, v_caller_org_user_id, v_caller_full_name, v_caller_email,
    'member_invited', 'invitation', v_invitation_id, null, v_email,
    null, null, jsonb_build_object('role', p_role, 'branch_access', p_branch_access), null
  );

  return query select v_invitation_id, p_token, v_expires_at;
end;
$$;

grant execute on function public.create_organization_invitation(text, text, text, uuid[], text)
  to authenticated;

-- ============================================================
-- resend_organization_invitation (0033) - actor identity resolved via the
-- helper instead of organization_users.full_name/email.
-- ============================================================

create or replace function public.resend_organization_invitation(
  p_invitation_id uuid,
  p_token text
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation_org_id uuid;
  v_invitation_email text;
  v_expires_at timestamptz;
  v_actor record;
  v_actor_identity record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  select organization_id, email into v_invitation_org_id, v_invitation_email
  from public.organization_invitations
  where id = p_invitation_id;

  if v_invitation_org_id is null or not public.is_organization_ceo(v_invitation_org_id) then
    raise exception 'Invitation not found';
  end if;

  v_expires_at := now() + interval '7 days';

  update public.organization_invitations
  set token = p_token, expires_at = v_expires_at
  where id = p_invitation_id and accepted_at is null;

  if not found then
    raise exception 'This invitation has already been accepted';
  end if;

  select * into v_actor from public.organization_users
  where user_id = v_uid and organization_id = v_invitation_org_id and status = 'Active';

  select * into v_actor_identity from public.resolve_organization_user_identity(v_uid);

  perform public.log_organization_audit_event(
    v_invitation_org_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'invitation_resent', 'invitation', p_invitation_id, null, v_invitation_email,
    null, null, null, null
  );

  return query select p_token, v_expires_at;
end;
$$;

grant execute on function public.resend_organization_invitation(uuid, text) to authenticated;

-- ============================================================
-- accept_organization_invitation (0016/0033) - the INSERT no longer lists
-- full_name/email. p_full_name is still required/validated - the client
-- (AcceptOrganizationInvitationForm.tsx) already carries it into auth
-- signup metadata as pending_full_name for the signup branch; the
-- sign-in branch (existing account) is separately updated (see the
-- client-side change accompanying this migration) to also set that
-- metadata before calling this, so resolve_organization_user_identity's
-- fallback chain picks it up either way.
-- ============================================================

create or replace function public.accept_organization_invitation(
  p_token text,
  p_full_name text
)
returns table (organization_id uuid, organization_user_id uuid, role text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_email text;
  v_invitation record;
  v_organization_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if exists (select 1 from public.organization_users where user_id = v_uid) then
    raise exception 'This account is already linked to an organization';
  end if;

  select * into v_invitation
  from public.organization_invitations
  where token = p_token
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

  insert into public.organization_users (
    organization_id, user_id, role, branch_access, status, invited_by
  )
  values (
    v_invitation.organization_id, v_uid,
    v_invitation.role, v_invitation.branch_access, 'Active', v_invitation.invited_by
  )
  returning id into v_organization_user_id;

  if v_invitation.branch_access = 'selected' then
    insert into public.organization_user_branches (organization_user_id, clinic_id)
    select v_organization_user_id, clinic_id
    from public.organization_invitation_branches
    where invitation_id = v_invitation.id;
  end if;

  update public.organization_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  perform public.log_organization_audit_event(
    v_invitation.organization_id, v_organization_user_id, trim(p_full_name), v_invitation.email,
    'invitation_accepted', 'organization_user', v_organization_user_id, trim(p_full_name), v_invitation.email,
    null, null, jsonb_build_object('role', v_invitation.role, 'branch_access', v_invitation.branch_access), null
  );

  return query select
    v_invitation.organization_id, v_organization_user_id, v_invitation.role, trim(p_full_name);
end;
$$;

grant execute on function public.accept_organization_invitation(text, text) to authenticated;

-- ============================================================
-- cancel_organization_invitation (0033) - actor identity via the helper.
-- ============================================================

create or replace function public.cancel_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
  v_actor record;
  v_actor_identity record;
begin
  select * into v_invitation from public.organization_invitations where id = p_invitation_id;

  if v_invitation.id is null then
    raise exception 'Invitation not found';
  end if;

  if not public.is_organization_ceo(v_invitation.organization_id) then
    raise exception 'Only the organization''s CEO can cancel an invitation';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_invitation.organization_id and status = 'Active';

  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  delete from public.organization_invitations where id = p_invitation_id;

  perform public.log_organization_audit_event(
    v_invitation.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'invitation_cancelled', 'invitation', v_invitation.id, null, v_invitation.email,
    null, null, null, jsonb_build_object('role', v_invitation.role)
  );
end;
$$;

grant execute on function public.cancel_organization_invitation(uuid) to authenticated;

-- ============================================================
-- suspend_organization_member / reactivate_organization_member /
-- remove_organization_member / update_organization_member (0033) - target
-- and actor identity resolved via the helper instead of
-- v_target.full_name/v_actor.full_name (organization_users no longer
-- yields those from `select *`).
-- ============================================================

create or replace function public.suspend_organization_member(p_organization_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_actor record;
  v_target_identity record;
  v_actor_identity record;
begin
  select * into v_target from public.organization_users where id = p_organization_user_id;

  if v_target.id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_organization_ceo(v_target.organization_id) then
    raise exception 'Only the organization''s CEO can suspend a member';
  end if;

  if v_target.role = 'CEO' then
    raise exception 'The CEO cannot be suspended';
  end if;

  if v_target.status = 'Suspended' then
    return;
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_target.organization_id and status = 'Active';

  select * into v_target_identity from public.resolve_organization_user_identity(v_target.user_id);
  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  update public.organization_users
  set status = 'Suspended', updated_at = now()
  where id = p_organization_user_id;

  delete from public.clinic_users where organization_user_id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'member_suspended', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
    null, jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'Suspended'), null
  );
end;
$$;

grant execute on function public.suspend_organization_member(uuid) to authenticated;

create or replace function public.reactivate_organization_member(p_organization_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_actor record;
  v_target_identity record;
  v_actor_identity record;
begin
  select * into v_target from public.organization_users where id = p_organization_user_id;

  if v_target.id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_organization_ceo(v_target.organization_id) then
    raise exception 'Only the organization''s CEO can reactivate a member';
  end if;

  if v_target.status <> 'Suspended' then
    raise exception 'Only a suspended member can be reactivated';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_target.organization_id and status = 'Active';

  select * into v_target_identity from public.resolve_organization_user_identity(v_target.user_id);
  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  update public.organization_users
  set status = 'Active', updated_at = now()
  where id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'member_reactivated', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
    null, jsonb_build_object('status', 'Suspended'), jsonb_build_object('status', 'Active'), null
  );
end;
$$;

grant execute on function public.reactivate_organization_member(uuid) to authenticated;

create or replace function public.remove_organization_member(p_organization_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_actor record;
  v_target_identity record;
  v_actor_identity record;
begin
  select * into v_target from public.organization_users where id = p_organization_user_id;

  if v_target.id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_organization_ceo(v_target.organization_id) then
    raise exception 'Only the organization''s CEO can remove a member';
  end if;

  if v_target.role = 'CEO' then
    raise exception 'The CEO cannot be removed';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_target.organization_id and status = 'Active';

  select * into v_target_identity from public.resolve_organization_user_identity(v_target.user_id);
  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  delete from public.clinic_users where organization_user_id = p_organization_user_id;

  update public.organization_users
  set status = 'Removed', updated_at = now()
  where id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'member_removed', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
    null, jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'Removed'), null
  );
end;
$$;

grant execute on function public.remove_organization_member(uuid) to authenticated;

create or replace function public.update_organization_member(
  p_organization_user_id uuid,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_actor record;
  v_target_identity record;
  v_actor_identity record;
  v_before_branch_ids uuid[];
  v_after_branch_ids uuid[];
  v_before_names text[];
  v_after_names text[];
  v_branch_id uuid;
begin
  select * into v_target from public.organization_users where id = p_organization_user_id;

  if v_target.id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_organization_ceo(v_target.organization_id) then
    raise exception 'Only the organization''s CEO can edit a member';
  end if;

  if v_target.role = 'CEO' or p_role = 'CEO' then
    raise exception 'The CEO role cannot be changed through this function';
  end if;

  if p_role not in ('Partner', 'Manager', 'Viewer') then
    raise exception 'Invalid role';
  end if;

  if p_branch_access not in ('all', 'selected') then
    raise exception 'Invalid branch access';
  end if;

  if p_branch_access = 'selected'
     and (p_branch_ids is null or array_length(p_branch_ids, 1) is null) then
    raise exception 'Select at least one branch';
  end if;

  if p_branch_access = 'selected' then
    if exists (
      select 1
      from unnest(p_branch_ids) as bid
      left join public.clinics c
        on c.id = bid and c.organization_id = v_target.organization_id
      where c.id is null
    ) then
      raise exception 'One or more selected branches are invalid';
    end if;
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_target.organization_id and status = 'Active';

  select * into v_target_identity from public.resolve_organization_user_identity(v_target.user_id);
  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  if v_target.branch_access = 'all' then
    select coalesce(array_agg(c.id), array[]::uuid[]) into v_before_branch_ids
    from public.clinics c where c.organization_id = v_target.organization_id;
  else
    select coalesce(array_agg(oub.clinic_id), array[]::uuid[]) into v_before_branch_ids
    from public.organization_user_branches oub
    where oub.organization_user_id = p_organization_user_id;
  end if;

  update public.organization_users
  set role = p_role, branch_access = p_branch_access, updated_at = now()
  where id = p_organization_user_id;

  if p_branch_access = 'all' then
    delete from public.organization_user_branches
    where organization_user_id = p_organization_user_id;

    select coalesce(array_agg(c.id), array[]::uuid[]) into v_after_branch_ids
    from public.clinics c where c.organization_id = v_target.organization_id;
  else
    foreach v_branch_id in array p_branch_ids loop
      insert into public.organization_user_branches (organization_user_id, clinic_id)
      values (p_organization_user_id, v_branch_id)
      on conflict (organization_user_id, clinic_id) do nothing;
    end loop;

    delete from public.organization_user_branches
    where organization_user_id = p_organization_user_id
      and clinic_id <> all (p_branch_ids);

    v_after_branch_ids := p_branch_ids;
  end if;

  if v_target.role <> p_role then
    perform public.log_organization_audit_event(
      v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
      'member_role_changed', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
      null, jsonb_build_object('role', v_target.role), jsonb_build_object('role', p_role), null
    );
  end if;

  if v_target.branch_access <> p_branch_access
     or not (
       v_before_branch_ids @> v_after_branch_ids
       and v_after_branch_ids @> v_before_branch_ids
     ) then

    select coalesce(array_agg(c.name order by c.name), array[]::text[]) into v_before_names
    from public.clinics c where c.id = any (v_before_branch_ids);

    select coalesce(array_agg(c.name order by c.name), array[]::text[]) into v_after_names
    from public.clinics c where c.id = any (v_after_branch_ids);

    perform public.log_organization_audit_event(
      v_target.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
      'member_branches_changed', 'organization_user', v_target.id, v_target_identity.full_name, v_target_identity.email,
      null,
      jsonb_build_object('branch_access', v_target.branch_access, 'branches', to_jsonb(v_before_names)),
      jsonb_build_object('branch_access', p_branch_access, 'branches', to_jsonb(v_after_names)),
      null
    );
  end if;
end;
$$;

grant execute on function public.update_organization_member(uuid, text, text, uuid[]) to authenticated;

-- ============================================================
-- get_organization_team_roster (0033) - org_rows now resolves full_name/
-- email via the helper (LATERAL, one call per person) instead of ou.full_
-- name/ou.email. clinic_rows is UNCHANGED - cu.full_name/cu.email are
-- real, populated columns on clinic_users, never part of this bug.
-- ============================================================

create or replace function public.get_organization_team_roster(
  p_organization_id uuid,
  p_search text default null,
  p_role text default null,
  p_status text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  member_key text,
  source text,
  organization_user_id uuid,
  clinic_user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  branch_scope text,
  branch_ids uuid[],
  branch_names text[],
  invited_by_name text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_organization_ceo(p_organization_id) then
    raise exception 'Only the organization''s CEO can view the team roster';
  end if;

  return query
  with org_rows as (
    select
      'org:' || ou.id as member_key,
      'organization'::text as source,
      ou.id as organization_user_id,
      null::uuid as clinic_user_id,
      ident.full_name,
      ident.email,
      ou.role,
      ou.status,
      ou.branch_access as branch_scope,
      case
        when ou.branch_access = 'all' then
          (select coalesce(array_agg(c.id order by c.name), array[]::uuid[])
           from public.clinics c where c.organization_id = p_organization_id)
        else
          (select coalesce(array_agg(c.id order by c.name), array[]::uuid[])
           from public.organization_user_branches oub
           join public.clinics c on c.id = oub.clinic_id
           where oub.organization_user_id = ou.id)
      end as branch_ids,
      case
        when ou.branch_access = 'all' then
          (select coalesce(array_agg(c.name order by c.name), array[]::text[])
           from public.clinics c where c.organization_id = p_organization_id)
        else
          (select coalesce(array_agg(c.name order by c.name), array[]::text[])
           from public.organization_user_branches oub
           join public.clinics c on c.id = oub.clinic_id
           where oub.organization_user_id = ou.id)
      end as branch_names,
      nullif(inviter_ident.full_name, '') as invited_by_name,
      ou.created_at
    from public.organization_users ou
    cross join lateral public.resolve_organization_user_identity(ou.user_id) as ident
    left join public.organization_users inviter on inviter.id = ou.invited_by
    left join lateral public.resolve_organization_user_identity(inviter.user_id) as inviter_ident on true
    where ou.organization_id = p_organization_id
  ),
  clinic_rows as (
    select
      'clinic:' || cu.id as member_key,
      'clinic'::text as source,
      null::uuid as organization_user_id,
      cu.id as clinic_user_id,
      cu.full_name,
      cu.email,
      cu.role,
      cu.status,
      'single'::text as branch_scope,
      array[cu.clinic_id]::uuid[] as branch_ids,
      array[c.name]::text[] as branch_names,
      null::text as invited_by_name,
      cu.created_at
    from public.clinic_users cu
    join public.clinics c on c.id = cu.clinic_id
    where c.organization_id = p_organization_id
      and cu.organization_user_id is null
  ),
  combined as (
    select * from org_rows
    union all
    select * from clinic_rows
  ),
  filtered as (
    select *
    from combined
    where
      (p_role is null or role = p_role)
      and (
        (p_status is not null and status = p_status)
        or (p_status is null and status <> 'Removed')
      )
      and (
        p_search is null or length(trim(p_search)) = 0
        or full_name ilike '%' || p_search || '%'
        or email ilike '%' || p_search || '%'
        or exists (
          select 1 from unnest(branch_names) bn where bn ilike '%' || p_search || '%'
        )
      )
  )
  select
    member_key, source, organization_user_id, clinic_user_id, full_name, email, role, status,
    branch_scope, branch_ids, branch_names, invited_by_name, created_at,
    count(*) over() as total_count
  from filtered
  order by full_name asc, email asc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.get_organization_team_roster(uuid, text, text, text, int, int)
  to authenticated;

-- ============================================================
-- suspend_clinic_user_for_organization / reactivate_.../ remove_... (0033)
-- - already correct (clinic_users.full_name/email are real columns), only
-- the actor identity needs resolving via the helper.
-- ============================================================

create or replace function public.suspend_clinic_user_for_organization(p_clinic_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_clinic record;
  v_actor record;
  v_actor_identity record;
begin
  select cu.* into v_target from public.clinic_users cu where cu.id = p_clinic_user_id;

  if v_target.id is null then
    raise exception 'Staff member not found';
  end if;

  if v_target.organization_user_id is not null then
    raise exception 'This person has organization-level access - use suspend_organization_member instead';
  end if;

  select c.* into v_clinic from public.clinics c where c.id = v_target.clinic_id;

  if v_clinic.organization_id is null then
    raise exception 'This clinic is not part of an organization';
  end if;

  if not public.is_organization_ceo(v_clinic.organization_id) then
    raise exception 'Only the organization''s CEO can manage this staff member from Team & Access';
  end if;

  if v_target.role = 'Owner' then
    raise exception 'The clinic owner cannot be suspended';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_clinic.organization_id and status = 'Active';

  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  update public.clinic_users set status = 'Suspended' where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'clinic_access_suspended', 'clinic_user', v_target.id, v_target.full_name, v_target.email,
    v_clinic.id, jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'Suspended'), null
  );
end;
$$;

grant execute on function public.suspend_clinic_user_for_organization(uuid) to authenticated;

create or replace function public.reactivate_clinic_user_for_organization(p_clinic_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_clinic record;
  v_actor record;
  v_actor_identity record;
begin
  select cu.* into v_target from public.clinic_users cu where cu.id = p_clinic_user_id;

  if v_target.id is null then
    raise exception 'Staff member not found';
  end if;

  if v_target.organization_user_id is not null then
    raise exception 'This person has organization-level access - use reactivate_organization_member instead';
  end if;

  select c.* into v_clinic from public.clinics c where c.id = v_target.clinic_id;

  if v_clinic.organization_id is null then
    raise exception 'This clinic is not part of an organization';
  end if;

  if not public.is_organization_ceo(v_clinic.organization_id) then
    raise exception 'Only the organization''s CEO can manage this staff member from Team & Access';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_clinic.organization_id and status = 'Active';

  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  update public.clinic_users set status = 'Active' where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'clinic_access_reactivated', 'clinic_user', v_target.id, v_target.full_name, v_target.email,
    v_clinic.id, jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'Active'), null
  );
end;
$$;

grant execute on function public.reactivate_clinic_user_for_organization(uuid) to authenticated;

create or replace function public.remove_clinic_user_for_organization(p_clinic_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_clinic record;
  v_actor record;
  v_actor_identity record;
begin
  select cu.* into v_target from public.clinic_users cu where cu.id = p_clinic_user_id;

  if v_target.id is null then
    raise exception 'Staff member not found';
  end if;

  if v_target.organization_user_id is not null then
    raise exception 'This person has organization-level access - use remove_organization_member instead';
  end if;

  select c.* into v_clinic from public.clinics c where c.id = v_target.clinic_id;

  if v_clinic.organization_id is null then
    raise exception 'This clinic is not part of an organization';
  end if;

  if not public.is_organization_ceo(v_clinic.organization_id) then
    raise exception 'Only the organization''s CEO can manage this staff member from Team & Access';
  end if;

  if v_target.role = 'Owner' then
    raise exception 'The clinic owner cannot be removed';
  end if;

  select * into v_actor from public.organization_users
  where user_id = auth.uid() and organization_id = v_clinic.organization_id and status = 'Active';

  select * into v_actor_identity from public.resolve_organization_user_identity(auth.uid());

  delete from public.clinic_users where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor_identity.full_name, v_actor_identity.email,
    'clinic_access_removed', 'clinic_user', v_target.id, v_target.full_name, v_target.email,
    v_clinic.id, jsonb_build_object('status', v_target.status), null, null
  );
end;
$$;

grant execute on function public.remove_clinic_user_for_organization(uuid) to authenticated;
