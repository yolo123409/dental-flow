-- Fixes 42702 "column reference role is ambiguous" from
-- get_organization_team_roster() (migrations 0033/0034).
--
-- ROOT CAUSE: the function's own `returns table (..., role text, status
-- text, full_name text, email text, branch_scope text, branch_ids uuid[],
-- branch_names text[], invited_by_name text, ...)` implicitly declares
-- every one of those names as an in-scope PL/pgSQL variable for the whole
-- function body - exactly the same mechanism as the earlier
-- switch_active_branch clinic_id bug (0031), just triggered by a different
-- column this time. The `combined`/`filtered` CTEs both project columns
-- with those exact same names (they union org_rows/clinic_rows, which
-- were themselves already fully alias-qualified and are NOT the problem).
-- The bug is specifically in the `filtered` CTE's WHERE clause and the
-- final SELECT/ORDER BY, which referenced `role`, `status`, `full_name`,
-- `email`, `branch_names` UNQUALIFIED - Postgres could not tell whether
-- each meant the PL/pgSQL output variable or the CTE's own column, so it
-- errors rather than silently guessing (default `#variable_conflict
-- error`). `role` was the first one the planner happened to report;
-- `status`/`full_name`/`email`/`branch_names` (used in the search clause)
-- and every column in the final SELECT/ORDER BY have the exact same
-- latent ambiguity and are fixed here too, not just the one reported line.
--
-- AUTHORITATIVE SOURCE OF `role` (unchanged by this fix, confirmed
-- correct): organization_users.role for org-sourced rows, clinic_users.role
-- for clinic-sourced rows - both already read correctly via `ou.role`/
-- `cu.role` inside org_rows/clinic_rows (those two CTEs were never
-- ambiguous - every reference there was already alias-qualified). This fix
-- only changes how `combined`/`filtered`'s OWN columns are referenced
-- downstream, not where `role` originates.
--
-- FIX: every reference to a `combined`/`filtered` column is now qualified
-- with the CTE's own name (`combined.role`, `filtered.status`, etc.)
-- instead of left bare - eliminates the PL/pgSQL-variable-vs-column
-- ambiguity throughout, matching the same "qualify every table-column
-- reference, not just the one that errored, for defense in depth"
-- principle 0031 already established for switch_active_branch.
--
-- Checked every other function in 0033/0034 for the same pattern (any
-- `returns table (...)` whose body references a bare identifier matching
-- one of its own output column names): none found. Every void-returning
-- function (suspend/reactivate/remove/update_organization_member, the
-- clinic_user_for_organization trio, cancel_organization_invitation) has
-- no output columns at all, so this class of bug cannot occur in them.
-- create_organization_with_ceo, create_organization_invitation, resend_
-- organization_invitation, accept_organization_invitation, switch_active_
-- branch, get_organization_audit_log, and resolve_organization_user_
-- identity were all already fully qualified or only ever referenced their
-- output names via prefixed locals (v_.../p_...) or dotted record access
-- (v_invitation.role, etc.), never bare - confirmed safe, not touched.
--
-- Safe to re-run: create or replace function, signature unchanged.

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
    select combined.*
    from combined
    where
      (p_role is null or combined.role = p_role)
      and (
        (p_status is not null and combined.status = p_status)
        or (p_status is null and combined.status <> 'Removed')
      )
      and (
        p_search is null or length(trim(p_search)) = 0
        or combined.full_name ilike '%' || p_search || '%'
        or combined.email ilike '%' || p_search || '%'
        or exists (
          select 1 from unnest(combined.branch_names) bn where bn ilike '%' || p_search || '%'
        )
      )
  )
  select
    filtered.member_key,
    filtered.source,
    filtered.organization_user_id,
    filtered.clinic_user_id,
    filtered.full_name,
    filtered.email,
    filtered.role,
    filtered.status,
    filtered.branch_scope,
    filtered.branch_ids,
    filtered.branch_names,
    filtered.invited_by_name,
    filtered.created_at,
    count(*) over() as total_count
  from filtered
  order by filtered.full_name asc, filtered.email asc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function public.get_organization_team_roster(uuid, text, text, text, int, int)
  to authenticated;
