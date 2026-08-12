-- Closes a latent gap found during the multi-branch architecture audit:
-- organization_user_branches.clinic_id was never DB-constrained to belong
-- to the same organization as the row's own organization_user_id. Every
-- consumer (switch_active_branch, get_organization_branch_ids,
-- get_organization_branch_performance, get_organization_revenue_trend,
-- create_organization_invitation) already re-checks this defensively by
-- re-intersecting with clinics.organization_id, so this was never an
-- exploitable leak - but it meant any future query that read this table
-- directly without that same re-check would inherit the gap. Closing it
-- at the source (the insert policy) means new code doesn't have to
-- remember to re-derive it every time.
--
-- Safe to re-run: drop-if-exists/create throughout, matching every other
-- migration in this folder.

drop policy if exists "organization_user_branches_insert_ceo_only" on public.organization_user_branches;
create policy "organization_user_branches_insert_ceo_only"
  on public.organization_user_branches for insert
  with check (
    exists (
      select 1 from public.organization_users ou
      where ou.id = organization_user_branches.organization_user_id
        and public.is_organization_ceo(ou.organization_id)
        -- The branch being granted must belong to the SAME organization as
        -- the member receiving access - without this, a CEO could grant
        -- (or a compromised client could attempt to grant) one of their
        -- own org's members access to a clinic under a different
        -- organization entirely, by supplying an arbitrary clinic_id.
        and exists (
          select 1 from public.clinics c
          where c.id = organization_user_branches.clinic_id
            and c.organization_id = ou.organization_id
        )
    )
  );
