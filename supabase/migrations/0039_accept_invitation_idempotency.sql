-- Fix for "Invitation not found" after successful authentication.
--
-- Root cause (confirmed by reproducing the full flow live against this
-- project - real create_organization_invitation call, real resend, real
-- accept, not just reading the source): app/api/organization-invitations/
-- [id]/resend/route.ts rotated organization_invitations.token AND the
-- pre-created invitee's password, but never updated that account's
-- user_metadata.pending_organization_invitation_token to match the new
-- token. AuthContext.loadProfile reads that stale token on first login and
-- calls accept_organization_invitation(stale_token, ...) - the RPC's own
-- `where token = p_token for update` then matches zero rows (the row's
-- token column has since changed) and raises exactly 'Invitation not
-- found' (P0001). Confirmed empirically: accepting with the CURRENT token
-- on the same session succeeds immediately - the RPC, RLS, and email
-- normalization were never the problem. The application-layer fix (keeping
-- user_metadata in sync on rotation) lives in the route, not here.
--
-- This migration is the second, explicitly-requested half: make
-- accept_organization_invitation idempotent, so a genuine duplicate
-- acceptance request (double-submit, a React effect re-running, a retried
-- network request) returns the existing membership instead of erroring -
-- and specifically never returns "Invitation not found" for a request that
-- already succeeded once. This was not the cause of the reported bug (the
-- function already refused to double-insert via the "already linked"
-- check), but is real hardening the spec explicitly calls for.
--
-- Safe to re-run: create-or-replace only, same signature as installed.

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
  v_existing_role text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  select * into v_invitation
  from public.organization_invitations
  where token = p_token
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  -- Idempotent replay: if this exact caller already has a membership in
  -- THIS invitation's organization - because this exact acceptance already
  -- ran once, or a concurrent call finished first - return that membership
  -- instead of erroring. Never raises for a request that already
  -- succeeded, regardless of how many times it's retried.
  select ou.id, ou.role into v_organization_user_id, v_existing_role
  from public.organization_users ou
  where ou.user_id = v_uid and ou.organization_id = v_invitation.organization_id;

  if v_organization_user_id is not null then
    return query select
      v_invitation.organization_id, v_organization_user_id, v_existing_role, trim(p_full_name);
    return;
  end if;

  if exists (select 1 from public.organization_users where user_id = v_uid) then
    raise exception 'This account is already linked to a different organization';
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
