-- Fix: check_invitation_email_has_account (0033) incorrectly reports
-- "account exists" for brand-new invitees.
--
-- ROOT CAUSE: check_invitation_email_has_account was written in migration
-- 0033, before migration 0037 introduced auto-provisioning - when a CEO
-- invites a brand-new email, app/api/organization-invitations/route.ts now
-- pre-creates that person's auth.users row itself (supabaseAdmin.auth.
-- admin.createUser) with a generated temporary password, purely so a
-- credentials email can be sent (organization_invitations.
-- provisioned_auth_user_id records this). check_invitation_email_has_account
-- was never updated for this: its plain `exists (select 1 from auth.users
-- where email = ...)` matches this self-provisioned, never-activated shell
-- account too, so the invite-accept page tells a genuinely brand-new
-- invitee to "sign in" - to an account they never registered and have no
-- real password for (they'd only ever have one if the credentials email
-- was actually delivered and read).
--
-- FIX: a provisioned-but-never-activated account (app_metadata.
-- must_change_password still true - the same flag
-- resend_organization_invitation already uses to decide whether an account
-- has completed its first login) must be treated as "no account yet", not
-- "existing account". Only once that flag has flipped to false (real first
-- login completed) does it count as a genuine existing account. Invitations
-- with no provisioned_auth_user_id (the "existing_account" branch - the
-- person already had an account before being invited) are unaffected and
-- keep the original direct auth.users lookup.
--
-- Does not touch organization_invitations data, invitation tokens, or any
-- other invitation function.

create or replace function public.check_invitation_email_has_account(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_email text;
  v_provisioned_auth_user_id uuid;
  v_must_change_password boolean;
  v_found boolean;
begin
  select email, provisioned_auth_user_id
  into v_email, v_provisioned_auth_user_id
  from public.organization_invitations
  where token = p_token;

  if v_email is null then
    return false;
  end if;

  if v_provisioned_auth_user_id is not null then
    select coalesce((u.raw_app_meta_data ->> 'must_change_password')::boolean, false), true
    into v_must_change_password, v_found
    from auth.users u
    where u.id = v_provisioned_auth_user_id;

    -- The provisioned row no longer exists (e.g. manually removed) -
    -- definitely nothing to sign into.
    if not coalesce(v_found, false) then
      return false;
    end if;

    return not v_must_change_password;
  end if;

  return exists (
    select 1 from auth.users u where lower(u.email) = lower(v_email)
  );
end;
$$;

grant execute on function public.check_invitation_email_has_account(text) to anon, authenticated;
