-- Secure temporary-password onboarding for organization invitations.
--
-- When a CEO invites a brand-new email (no existing auth.users row), the new
-- app/api/organization-invitations route now pre-creates that person's auth
-- account server-side (supabaseAdmin.auth.admin.createUser) with a
-- cryptographically generated temporary password, instead of leaving them to
-- self-signup at /org-invite/[token]. Existing-account invitees are
-- completely unaffected - this migration adds nothing that changes their
-- path.
--
-- This migration does NOT touch create_organization_invitation,
-- accept_organization_invitation, or resend_organization_invitation - all
-- existing validation/authorization in those functions is reused unchanged.
-- The password itself is never stored anywhere in Postgres; the
-- must_change_password flag lives in auth.users.app_metadata (set via the
-- admin API only - not writable by the client's own
-- supabase.auth.updateUser(), unlike user_metadata), so there is nothing
-- for this migration to add for that flag either.
--
-- Safe to re-run: every statement is idempotent.

-- ============================================================
-- 1. organization_invitations.provisioned_auth_user_id - nullable FK, set
--    only when this flow pre-created an account for a new invitee. This is
--    a relationship, not duplicated password/email state: it exists so
--    "resend" can find the right auth user to rotate credentials for,
--    without an unreliable scan-and-filter-by-email of auth.users (the
--    admin API has no direct get-user-by-email lookup).
-- ============================================================

alter table public.organization_invitations
  add column if not exists provisioned_auth_user_id uuid references auth.users(id) on delete set null;

-- ============================================================
-- 2. link_organization_invitation_provisioned_user - called by the new API
--    route (via a caller-scoped client, not the service-role client) right
--    after auth.admin.createUser succeeds, so this write goes through the
--    same authorized-RPC surface as every other organization mutation
--    instead of a raw service-role table write. Re-derives the invitation's
--    org and re-checks is_organization_ceo() via auth.uid(), same
--    defense-in-depth convention as every other function in this file.
-- ============================================================

create or replace function public.link_organization_invitation_provisioned_user(
  p_invitation_id uuid,
  p_auth_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
begin
  select * into v_invitation from public.organization_invitations where id = p_invitation_id;

  if v_invitation.id is null then
    raise exception 'Invitation not found';
  end if;

  if not public.is_organization_ceo(v_invitation.organization_id) then
    raise exception 'Only the organization''s CEO can complete this invitation';
  end if;

  if p_auth_user_id is null then
    raise exception 'Auth user id is required';
  end if;

  update public.organization_invitations
  set provisioned_auth_user_id = p_auth_user_id
  where id = p_invitation_id;
end;
$$;

grant execute on function public.link_organization_invitation_provisioned_user(uuid, uuid) to authenticated;

-- ============================================================
-- 3. get_organization_pending_invitations - add credentials_issued so the
--    Pending Invitations table can distinguish "temporary credentials
--    issued, awaiting first login" (new account, pre-created by this flow)
--    from "awaiting sign-in" (existing account) / "awaiting signup" (the
--    legacy self-serve path, for any invitation created before this
--    migration). Return type changes (new output column), so this needs a
--    drop first even though the argument list is unchanged - same
--    "create or replace only replaces an identical signature" rule this
--    migration file series has followed since 0029/0036. Body is otherwise
--    byte-for-byte unchanged from 0036.
-- ============================================================

drop function if exists public.get_organization_pending_invitations(uuid);

create or replace function public.get_organization_pending_invitations(p_organization_id uuid)
returns table (
  id uuid,
  email text,
  full_name text,
  message text,
  role text,
  branch_access text,
  branch_names text[],
  token text,
  invited_by_name text,
  expires_at timestamptz,
  created_at timestamptz,
  is_expired boolean,
  credentials_issued boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_organization_ceo(p_organization_id) then
    raise exception 'Only the organization''s CEO can view pending invitations';
  end if;

  return query
  select
    oi.id,
    oi.email,
    oi.full_name,
    oi.message,
    oi.role,
    oi.branch_access,
    case
      when oi.branch_access = 'all' then
        (select coalesce(array_agg(c.name order by c.name), array[]::text[])
         from public.clinics c where c.organization_id = p_organization_id)
      else
        (select coalesce(array_agg(c.name order by c.name), array[]::text[])
         from public.organization_invitation_branches oib
         join public.clinics c on c.id = oib.clinic_id
         where oib.invitation_id = oi.id)
    end as branch_names,
    oi.token,
    nullif(inviter_ident.full_name, '') as invited_by_name,
    oi.expires_at,
    oi.created_at,
    (oi.expires_at < now()) as is_expired,
    (oi.provisioned_auth_user_id is not null) as credentials_issued
  from public.organization_invitations oi
  left join public.organization_users inviter on inviter.id = oi.invited_by
  left join lateral public.resolve_organization_user_identity(inviter.user_id) as inviter_ident on true
  where oi.organization_id = p_organization_id
    and oi.accepted_at is null
  order by oi.created_at desc;
end;
$$;

grant execute on function public.get_organization_pending_invitations(uuid) to authenticated;
