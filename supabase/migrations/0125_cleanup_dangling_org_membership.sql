-- Full-app audit fix H16: removing a Member's LAST clinic_users row
-- within an organization leaves their organization_users row (globally
-- unique per person - migration 0055) permanently dangling. There is no
-- "leave org" feature anywhere, so that person can never join or start
-- another organization again - their one auth_user_id slot in
-- organization_users is stuck forever pointing at an org they have zero
-- remaining branch access to.
--
-- THE FIX: an AFTER DELETE trigger on clinic_users - when the deleted
-- row's owner has zero remaining clinic_users rows in ANY clinic
-- belonging to the same organization, remove their organization_users
-- row too. Scoped to role = 'Member' only - a CEO's org membership
-- ending is a separate, deliberate decision (transferring/dissolving the
-- org), never an incidental side effect of a branch-staff removal.
--
-- Independent (non-multi-branch) clinics are unaffected: their
-- clinics.organization_id is null, so the trigger returns immediately.

create or replace function public._trigger_cleanup_dangling_org_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_remaining_in_org int;
begin
  if OLD.auth_user_id is null then
    -- A pending invitation row (never accepted) - nothing to clean up.
    return OLD;
  end if;

  select organization_id into v_org_id
  from public.clinics
  where id = OLD.clinic_id;

  if v_org_id is null then
    return OLD;
  end if;

  select count(*) into v_remaining_in_org
  from public.clinic_users cu
  join public.clinics c on c.id = cu.clinic_id
  where cu.auth_user_id = OLD.auth_user_id
    and c.organization_id = v_org_id;

  if v_remaining_in_org = 0 then
    delete from public.organization_users
    where auth_user_id = OLD.auth_user_id
      and organization_id = v_org_id
      and role = 'Member';
  end if;

  return OLD;
end;
$$;

drop trigger if exists trg_cleanup_dangling_org_membership on public.clinic_users;
create trigger trg_cleanup_dangling_org_membership
  after delete on public.clinic_users
  for each row execute function public._trigger_cleanup_dangling_org_membership();
