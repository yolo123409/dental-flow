-- Root-cause fix for onboarding appearing to succeed (RPC creates the
-- clinic_users row) but the app still failing with "No authenticated
-- clinic user found": authenticated users could not read back their OWN
-- clinic_users row. Verified directly against the live project - a
-- freshly-created row was invisible to its own owner (status 200, no
-- error, zero rows) even though the JWT was valid.
--
-- clinic_users.SELECT had either no working policy, or one that doesn't
-- match on auth_user_id = auth.uid(). This is also the load-bearing table
-- for every EXISTS(...) subquery in 0001's other policies (dentists,
-- appointments, clinics, clinic_settings, clinic_roles all check clinic
-- membership by querying clinic_users), so without this fix those were
-- silently non-functional for real logged-in users too.
--
-- Postgres RLS policies are OR'd together (permissive by default), so
-- adding this doesn't remove/conflict with whatever policy already exists
-- on this table - it just guarantees self-read works.

alter table public.clinic_users enable row level security;

drop policy if exists "clinic_users_select_self" on public.clinic_users;
create policy "clinic_users_select_self"
  on public.clinic_users for select
  using (auth_user_id = auth.uid());
