-- Real email delivery for organization invitations (Resend). Sending itself
-- happens in app/api/organization-invitations/* (route handlers, not SQL) -
-- this migration only adds the columns/RPC needed to persist and re-read
-- the outcome honestly, so a reloaded Pending Invitations page still shows
-- accurate delivery state instead of just at send time.
--
-- Sending is synchronous within the same request as invitation creation/
-- resend - there's no queue, so no transient "sending" state is persisted,
-- only the terminal outcome. email_error is the PROVIDER's own error
-- message only (e.g. "Invalid API key", a Resend 4xx body) - never
-- anything password-related; nothing in this feature ever writes a
-- plaintext password anywhere in Postgres.
--
-- Safe to re-run: every statement is idempotent.

-- ============================================================
-- 1. organization_invitations.email_status / email_error
-- ============================================================

alter table public.organization_invitations
  add column if not exists email_status text not null default 'not_configured';

alter table public.organization_invitations
  add column if not exists email_error text;

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'organization_invitations'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%email_status%';

  if v_constraint_name is not null then
    execute format('alter table public.organization_invitations drop constraint %I', v_constraint_name);
  end if;

  alter table public.organization_invitations
    add constraint organization_invitations_email_status_check
    check (email_status in ('sent', 'failed', 'not_configured'));
end $$;

-- ============================================================
-- 2. set_organization_invitation_email_status - called by the API routes
--    (via the caller-scoped client, not the service-role client) right
--    after a send attempt, same authorized-RPC-surface convention as
--    link_organization_invitation_provisioned_user (0037).
-- ============================================================

create or replace function public.set_organization_invitation_email_status(
  p_invitation_id uuid,
  p_status text,
  p_error text default null
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
    raise exception 'Only the organization''s CEO can update this invitation';
  end if;

  if p_status not in ('sent', 'failed', 'not_configured') then
    raise exception 'Invalid email status';
  end if;

  update public.organization_invitations
  set email_status = p_status, email_error = p_error
  where id = p_invitation_id;
end;
$$;

grant execute on function public.set_organization_invitation_email_status(uuid, text, text) to authenticated;

-- ============================================================
-- 3. get_organization_pending_invitations - add email_status/email_error so
--    the Pending Invitations table reflects real delivery state on every
--    load, not just immediately after sending. Return type changes, so
--    this needs a drop first (same rule as every prior signature/return
--    change in this file series). Body otherwise unchanged from 0037.
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
  credentials_issued boolean,
  email_status text,
  email_error text
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
    (oi.provisioned_auth_user_id is not null) as credentials_issued,
    oi.email_status,
    oi.email_error
  from public.organization_invitations oi
  left join public.organization_users inviter on inviter.id = oi.invited_by
  left join lateral public.resolve_organization_user_identity(inviter.user_id) as inviter_ident on true
  where oi.organization_id = p_organization_id
    and oi.accepted_at is null
  order by oi.created_at desc;
end;
$$;

grant execute on function public.get_organization_pending_invitations(uuid) to authenticated;

-- ============================================================
-- 4. create_organization_invitation - also return invited_by_name, so the
--    API route can put a real "Invited By" line in the existing-account
--    notification email without a second round-trip. Free: the function
--    already resolves this into v_caller_full_name for the audit log
--    write, this just also returns it. Return type changes (new output
--    column), so this needs a drop first even though the argument list is
--    unchanged. Body is otherwise byte-for-byte unchanged from 0036.
-- ============================================================

drop function if exists public.create_organization_invitation(text, text, text, uuid[], text, text, text);

create or replace function public.create_organization_invitation(
  p_email text,
  p_role text,
  p_branch_access text,
  p_branch_ids uuid[],
  p_token text,
  p_full_name text default null,
  p_message text default null
)
returns table (invitation_id uuid, token text, expires_at timestamptz, invited_by_name text)
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

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
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
    organization_id, email, full_name, message, role, branch_access, token, invited_by, expires_at
  )
  values (
    v_caller_org_id, v_email, trim(p_full_name), nullif(trim(coalesce(p_message, '')), ''),
    p_role, p_branch_access, p_token, v_caller_org_user_id, v_expires_at
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
    'member_invited', 'invitation', v_invitation_id, trim(p_full_name), v_email,
    null, null, jsonb_build_object('role', p_role, 'branch_access', p_branch_access), null
  );

  return query select v_invitation_id, p_token, v_expires_at, v_caller_full_name;
end;
$$;

grant execute on function public.create_organization_invitation(text, text, text, uuid[], text, text, text)
  to authenticated;
