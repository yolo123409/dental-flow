-- DentalFlow Enterprise, Phase 7: Team & Access.
--
-- Extends the existing organization-level Team & Access page
-- (organization_users/organization_invitations, migrations 0014/0016) with:
--   1. A real Suspended status for organization_users (today Active/Removed
--      only), plus an RLS tightening so status transitions only happen
--      through the new SECURITY DEFINER RPCs below (never a raw client
--      update), so every transition is guaranteed to also write an audit
--      row and run its cascade.
--   2. A persisted, tamper-resistant audit log (organization_audit_log) -
--      no insert/update/delete RLS policy at all, written only from inside
--      these RPCs.
--   3. A unified, paginated, searchable team roster RPC that lists both
--      organization_users (CEO/Partner/Manager/Viewer) and genuinely
--      locally-hired clinic_users (Owner/Admin/Dentist/Receptionist,
--      organization_user_id is null) across every branch in one call - the
--      first real pagination (OFFSET + total count) in this codebase's RPC
--      layer, needed because every existing list RPC (ORDER BY...LIMIT
--      only) doesn't scale to "100+ members across 52 branches".
--   4. check_invitation_email_has_account - lets the invite-accept flow
--      detect an existing DentalFlow account and switch to a sign-in
--      branch instead of failing supabase.auth.signUp().
--
-- IMPORTANT, discovered while building this migration (not a regression
-- introduced by it): clinic_users.status is NOT enforced by ANY RLS policy
-- in this schema - every clinic-scoped policy and is_clinic_owner_or_admin()
-- only ever check auth_user_id/clinic_id, never status. The existing clinic
-- Staff page's own "Suspend" feature (services/users.ts#suspendUser) is
-- therefore cosmetic today - a suspended clinic_users row still passes
-- every RLS check. Fixing that globally (touching ~24+ existing policies)
-- was explicitly decided to be out of scope for this phase. Instead, the
-- new suspend/remove RPCs below close the gap for organization-granted
-- access the only way that doesn't require touching existing RLS at all:
-- they HARD-DELETE the lazily-provisioned clinic_users rows
-- (organization_user_id = target) rather than status-flipping them. A
-- deleted row can't pass any RLS check, full stop. Reactivation needs no
-- restore step - switch_active_branch (0017/0031) already re-provisions a
-- fresh row automatically the next time that person switches into the
-- branch. Genuinely local hires managed from this same page (via
-- suspend_clinic_user_for_organization/reactivate_clinic_user_for_organization
-- below) intentionally keep the existing status-flip-only behavior,
-- unchanged from services/users.ts - same known limitation, not a new one.
--
-- Safe to re-run: idempotent throughout (create table/function if not
-- exists or or replace, drop policy if exists + create, self-healing DO
-- block for the status constraint), matching every other migration in this
-- folder.

-- ============================================================
-- 1. organization_users.status - widen to include 'Suspended'.
--
--    0014 declared this as an unnamed inline check constraint, so its
--    actual name is whatever Postgres's default-naming rule produced -
--    almost certainly organization_users_status_check, but per this
--    codebase's established policy (0031's email-column fix) of never
--    blindly guessing schema state, this looks the real name up via
--    information_schema before dropping it. Matching on the literal status
--    values (not just the word "status") avoids accidentally matching an
--    unrelated constraint that merely mentions the column name.
-- ============================================================

do $$
declare
  v_constraint_name text;
begin
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.check_constraints cc
    on cc.constraint_schema = tc.constraint_schema
    and cc.constraint_name = tc.constraint_name
  where tc.table_schema = 'public'
    and tc.table_name = 'organization_users'
    and tc.constraint_type = 'CHECK'
    and cc.check_clause ilike '%status%'
    and cc.check_clause ilike '%Active%'
    and cc.check_clause ilike '%Removed%'
  limit 1;

  if v_constraint_name is null then
    raise exception
      'Could not find organization_users'' status check constraint via information_schema. Inspect manually: select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = ''public.organization_users''::regclass and contype = ''c'';';
  end if;

  execute format(
    'alter table public.organization_users drop constraint %I',
    v_constraint_name
  );

  alter table public.organization_users
    add constraint organization_users_status_check
    check (status in ('Active', 'Suspended', 'Removed'));

  raise notice 'organization_users status constraint (was %) widened to include Suspended.', v_constraint_name;
end $$;

-- ============================================================
-- 2. Tighten organization_users_update_ceo_only so a raw client .update()
--    can only ever touch a row that is currently Active and stays Active -
--    i.e. the ordinary role/branch_access edit updateOrganizationMember
--    already does. Any transition into/out of Suspended, or into Removed,
--    must go through suspend_organization_member/reactivate_organization_
--    member/remove_organization_member below (SECURITY DEFINER, bypasses
--    RLS) - otherwise a CEO could suspend/remove someone via a plain
--    client update and silently skip both the audit log and the
--    clinic_users cascade.
-- ============================================================

drop policy if exists "organization_users_update_ceo_only" on public.organization_users;
create policy "organization_users_update_ceo_only"
  on public.organization_users for update
  using (
    organization_users.role <> 'CEO'
    and organization_users.status = 'Active'
    and public.is_organization_ceo(organization_users.organization_id)
  )
  with check (
    role <> 'CEO'
    and status = 'Active'
    and public.is_organization_ceo(organization_id)
  );

-- ============================================================
-- 3. organization_audit_log
--
--    actor/target full_name+email are stored redundantly (same rationale
--    as organization_users.full_name/email in 0014 - no central
--    user-profile table) so the trail stays fully readable even after a
--    clinic_users row is hard-deleted or an organization_invitations row
--    is cancelled (hard-deleted) - "historical actions stay attributable"
--    for the log itself, independent of what happens to the underlying
--    access-grant row. target_id deliberately has no FK - it's polymorphic
--    across three tables and one of them (invitations) is hard-deleted on
--    cancel, so a real FK would be either impossible or self-defeating.
-- ============================================================

create table if not exists public.organization_audit_log (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  actor_organization_user_id uuid references public.organization_users(id) on delete set null,
  actor_full_name text not null,
  actor_email text not null,

  action text not null check (action in (
    'member_invited', 'invitation_resent', 'invitation_cancelled', 'invitation_accepted',
    'member_role_changed', 'member_branches_changed',
    'member_suspended', 'member_reactivated', 'member_removed',
    'clinic_access_suspended', 'clinic_access_reactivated', 'clinic_access_removed',
    -- Reserved, unused in this phase - see the plan's "CEO transfer"
    -- section. Included now so a future transfer feature doesn't need a
    -- schema migration just to log itself.
    'ownership_transferred'
  )),

  target_kind text not null check (target_kind in ('organization_user', 'clinic_user', 'invitation')),
  target_id uuid,
  target_full_name text,
  target_email text not null,
  target_clinic_id uuid references public.clinics(id) on delete set null,

  before_value jsonb,
  after_value jsonb,
  metadata jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_organization_audit_log_org_created_at
  on public.organization_audit_log(organization_id, created_at desc);

create index if not exists idx_organization_audit_log_target_id
  on public.organization_audit_log(target_id);

alter table public.organization_audit_log enable row level security;

drop policy if exists "organization_audit_log_select_ceo_only" on public.organization_audit_log;
create policy "organization_audit_log_select_ceo_only"
  on public.organization_audit_log for select
  using (public.is_organization_ceo(organization_audit_log.organization_id));

-- Deliberately no insert/update/delete policy at all - every write happens
-- inside the SECURITY DEFINER functions below (which bypass RLS as the
-- function owner), never directly from a client. This IS the tamper-
-- resistance mechanism: no client call, however crafted, can forge or skip
-- an audit row.

-- ============================================================
-- 4. log_organization_audit_event - internal helper, not part of the
--    public API surface. Explicitly revoked from PUBLIC (rather than
--    relying on "just don't grant it", which every other function in this
--    codebase already does defensively for its own authenticated/anon
--    grants) so it can only ever be reached by being called from inside
--    another SECURITY DEFINER function in this same migration, never
--    directly by a client.
-- ============================================================

create or replace function public.log_organization_audit_event(
  p_organization_id uuid,
  p_actor_organization_user_id uuid,
  p_actor_full_name text,
  p_actor_email text,
  p_action text,
  p_target_kind text,
  p_target_id uuid,
  p_target_full_name text,
  p_target_email text,
  p_target_clinic_id uuid,
  p_before_value jsonb,
  p_after_value jsonb,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_audit_log (
    organization_id, actor_organization_user_id, actor_full_name, actor_email,
    action, target_kind, target_id, target_full_name, target_email, target_clinic_id,
    before_value, after_value, metadata
  ) values (
    p_organization_id, p_actor_organization_user_id, p_actor_full_name, p_actor_email,
    p_action, p_target_kind, p_target_id, p_target_full_name, p_target_email, p_target_clinic_id,
    p_before_value, p_after_value, p_metadata
  );
end;
$$;

revoke all on function public.log_organization_audit_event(
  uuid, uuid, text, text, text, text, uuid, text, text, uuid, jsonb, jsonb, jsonb
) from public;

-- ============================================================
-- 5. suspend_organization_member / reactivate_organization_member /
--    remove_organization_member - replace the direct-client-update path
--    for these three transitions (RLS, section 2, now blocks that path
--    anyway). Each: CEO-only, target role can never be CEO, atomically
--    mutates + writes one audit row.
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

  update public.organization_users
  set status = 'Suspended', updated_at = now()
  where id = p_organization_user_id;

  -- Closes the 0017-documented gap for real (see the migration header):
  -- deletes, not status-flips, every clinic_users row this member was
  -- lazily provisioned into. switch_active_branch re-provisions on
  -- reactivation automatically - no restore step needed here.
  delete from public.clinic_users where organization_user_id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
    'member_suspended', 'organization_user', v_target.id, v_target.full_name, v_target.email,
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

  update public.organization_users
  set status = 'Active', updated_at = now()
  where id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
    'member_reactivated', 'organization_user', v_target.id, v_target.full_name, v_target.email,
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

  -- Hard-delete, matching the existing deleteUser() precedent
  -- (services/users.ts) - FKs into clinic_users(id) are on delete set
  -- null, so historical treatment plans/expenses/etc. survive with
  -- attribution nulled, not deleted.
  delete from public.clinic_users where organization_user_id = p_organization_user_id;

  -- Soft-remove at the organization level - unchanged semantics from
  -- today's removeOrganizationMember (keeps history, matches "do not
  -- delete the Supabase account").
  update public.organization_users
  set status = 'Removed', updated_at = now()
  where id = p_organization_user_id;

  perform public.log_organization_audit_event(
    v_target.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
    'member_removed', 'organization_user', v_target.id, v_target.full_name, v_target.email,
    null, jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'Removed'), null
  );
end;
$$;

grant execute on function public.remove_organization_member(uuid) to authenticated;

-- ============================================================
-- 6. update_organization_member - replaces the body of today's client-side
--    updateOrganizationMember (3 raw .update()/.insert()/.delete() calls
--    via RLS) so the mutation and its audit write(s) happen atomically
--    server-side. Re-asserts the "role <> CEO" invariant itself (this RPC
--    bypasses RLS, unlike the old direct-update path). Keeps the existing
--    insert-before-delete branch-diff ordering from the current client
--    implementation (avoids a transient lockout window if the two halves
--    don't complete as a unit). Writes up to two separate audit rows - one
--    for role change, one for branch change - so a single Save that
--    changes both produces two distinct, individually meaningful log
--    entries, matching the spec's own separate line items.
--
--    External signature of services/organizations.ts#updateOrganizationMember
--    and EditOrganizationMemberModal.tsx do not change - only the service
--    body swaps to one .rpc() call.
-- ============================================================

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
      v_target.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
      'member_role_changed', 'organization_user', v_target.id, v_target.full_name, v_target.email,
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
      v_target.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
      'member_branches_changed', 'organization_user', v_target.id, v_target.full_name, v_target.email,
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
-- 7. cancel_organization_invitation - replaces today's direct client
--    DELETE so cancellation can also write an audit row before the row
--    disappears (organization_invitations has no soft-cancelled state -
--    cancel has always been a hard delete, see 0016).
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

  delete from public.organization_invitations where id = p_invitation_id;

  perform public.log_organization_audit_event(
    v_invitation.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
    'invitation_cancelled', 'invitation', v_invitation.id, null, v_invitation.email,
    null, null, null, jsonb_build_object('role', v_invitation.role)
  );
end;
$$;

grant execute on function public.cancel_organization_invitation(uuid) to authenticated;

-- ============================================================
-- 8. Amend create_organization_invitation / resend_organization_invitation
--    / accept_organization_invitation (create or replace, same technique
--    0031 used to amend 0016's functions) to each append one audit-log
--    insert. Bodies are otherwise byte-for-byte unchanged from 0016.
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

  select organization_id, id, full_name, email
    into v_caller_org_id, v_caller_org_user_id, v_caller_full_name, v_caller_email
  from public.organization_users
  where user_id = v_uid and status = 'Active' and role = 'CEO';

  if v_caller_org_id is null then
    raise exception 'Only the organization''s CEO can invite members';
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

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please provide a valid email address';
  end if;

  if exists (
    select 1 from public.organization_users
    where organization_id = v_caller_org_id and lower(email) = v_email
  ) then
    raise exception 'This person is already a member of this organization';
  end if;

  if exists (
    select 1 from public.organization_users where lower(email) = v_email
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

  perform public.log_organization_audit_event(
    v_invitation_org_id, v_actor.id, v_actor.full_name, v_actor.email,
    'invitation_resent', 'invitation', p_invitation_id, null, v_invitation_email,
    null, null, null, null
  );

  return query select p_token, v_expires_at;
end;
$$;

grant execute on function public.resend_organization_invitation(uuid, text) to authenticated;

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
    organization_id, user_id, full_name, email, role, branch_access, status, invited_by
  )
  values (
    v_invitation.organization_id, v_uid, trim(p_full_name), v_invitation.email,
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

  -- Self-service action - the actor IS the newly-created member, not the
  -- original inviter (deliberate convention, matches "accepted" being
  -- something the invitee does, not the CEO).
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
-- 9. check_invitation_email_has_account - lets the invite-accept UI detect
--    an existing DentalFlow account up front and switch to a sign-in
--    branch instead of calling supabase.auth.signUp() (which cannot
--    succeed for an email that already has an account). Never accepts a
--    client-supplied email - always derives it from the invitation's own
--    token, same pattern as get_organization_invitation_details, so this
--    cannot be used as an account-enumeration oracle for arbitrary emails.
-- ============================================================

create or replace function public.check_invitation_email_has_account(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_email text;
begin
  select email into v_email
  from public.organization_invitations
  where token = p_token;

  if v_email is null then
    return false;
  end if;

  return exists (
    select 1 from auth.users u where lower(u.email) = lower(v_email)
  );
end;
$$;

grant execute on function public.check_invitation_email_has_account(text) to anon, authenticated;

-- ============================================================
-- 10. suspend_clinic_user_for_organization / reactivate_.../ remove_... -
--     additive-only RPCs so genuinely local clinic_users hires
--     (organization_user_id is null) can be managed from the unified Team
--     & Access page with an org-scoped audit trail. Authorize via
--     is_organization_ceo() on the clinic's OWN organization_id, not
--     is_clinic_owner_or_admin() - the CEO acting from this page may have
--     no personal clinic_users row at that branch at all. Do NOT touch
--     services/users.ts or the existing clinic Staff page - this is
--     intentionally a second, parallel path, not a replacement, so the
--     existing Staff page is provably unaffected. Suspend/reactivate here
--     keep the exact same status-flip-only behavior as
--     services/users.ts#suspendUser/activateUser (see migration header for
--     why that's a known, pre-existing, out-of-scope-to-fix limitation).
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

  update public.clinic_users set status = 'Suspended' where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
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

  update public.clinic_users set status = 'Active' where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
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

  delete from public.clinic_users where id = p_clinic_user_id;

  perform public.log_organization_audit_event(
    v_clinic.organization_id, v_actor.id, v_actor.full_name, v_actor.email,
    'clinic_access_removed', 'clinic_user', v_target.id, v_target.full_name, v_target.email,
    v_clinic.id, jsonb_build_object('status', v_target.status), null, null
  );
end;
$$;

grant execute on function public.remove_clinic_user_for_organization(uuid) to authenticated;

-- ============================================================
-- 11. get_organization_team_roster - the unified, paginated, searchable
--     roster. Union of two DISJOINT populations:
--       (a) every organization_users row for this org, branch-expanded
--           ('all' -> every org clinic via clinics.organization_id,
--           'selected' -> organization_user_branches).
--       (b) every clinic_users row across the org's branches WHERE
--           organization_user_id IS NULL - genuine local hires only.
--     Lazily-provisioned clinic_users rows (organization_user_id is not
--     null) are deliberately EXCLUDED from (b) - they're already
--     represented via that same person's row in (a) (indirectly, through
--     branch_access), and excluding them is exactly what keeps
--     suspend/remove's cascade correct (those are precisely the rows that
--     get deleted). Showing them separately would double-list every
--     CEO/Partner/Manager who has ever switched into a branch.
--
--     First real pagination (OFFSET + a window-function total count) in
--     this codebase's RPC layer - every existing list RPC uses ORDER
--     BY...LIMIT only, which doesn't scale to "100+ members across 52
--     branches" (the Search Performance requirement this exists for).
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
      ou.full_name,
      ou.email,
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
      inviter.full_name as invited_by_name,
      ou.created_at
    from public.organization_users ou
    left join public.organization_users inviter on inviter.id = ou.invited_by
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
      -- Not tracked for locally-hired staff - clinic_users has no
      -- "invited by" pointer of its own (staff_invitations.invited_by
      -- points at the inviter's clinic_users row, not the invitee's).
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
-- 12. get_organization_audit_log - CEO-only paginated read, same
--     pagination convention as the roster above. Optional p_target_id lets
--     the Member Detail panel show one person's history without a
--     separate RPC.
-- ============================================================

create or replace function public.get_organization_audit_log(
  p_organization_id uuid,
  p_target_id uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  actor_full_name text,
  actor_email text,
  action text,
  target_kind text,
  target_id uuid,
  target_full_name text,
  target_email text,
  target_clinic_id uuid,
  target_clinic_name text,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb,
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
    raise exception 'Only the organization''s CEO can view the audit log';
  end if;

  return query
  select
    al.id, al.actor_full_name, al.actor_email, al.action, al.target_kind,
    al.target_id, al.target_full_name, al.target_email, al.target_clinic_id,
    c.name as target_clinic_name,
    al.before_value, al.after_value, al.metadata, al.created_at,
    count(*) over() as total_count
  from public.organization_audit_log al
  left join public.clinics c on c.id = al.target_clinic_id
  where al.organization_id = p_organization_id
    and (p_target_id is null or al.target_id = p_target_id)
  order by al.created_at desc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.get_organization_audit_log(uuid, uuid, int, int) to authenticated;
