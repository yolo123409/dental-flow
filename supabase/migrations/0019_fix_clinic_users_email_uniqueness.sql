-- ============================================================
-- Phase 5 follow-up: remove a stale single-clinic-era uniqueness
-- constraint on clinic_users.email that migration 0017 missed.
--
-- clinic_users itself predates this repo's migrations (created directly
-- in the Supabase project, like `clinics` - confirmed by grep: no
-- `create table` for it anywhere under supabase/migrations/). Its
-- original column definition appears to have included `email text
-- unique`, which Postgres auto-named clinic_users_email_key - a leftover
-- from the pre-Enterprise assumption that one person = one clinic = one
-- globally-unique email in this table.
--
-- Migration 0017 already replaced the *intended* invariant ("at most one
-- clinic_users row per auth user, ever" - previously enforced only by the
-- client's own .maybeSingle() throwing, never a real DB constraint) with
-- the correct per-branch version: unique(auth_user_id, clinic_id), named
-- clinic_users_auth_user_clinic_unique. But it did not know about this
-- separate, pre-existing constraint on email alone, which independently
-- blocks the same CEO-adds-a-second-branch flow:
-- create_clinic_with_admin (0015/0017) inserts a new clinic_users row
-- with the SAME auth_user_id and the SAME email (by design - it's the
-- same person) for a NEW clinic_id, and clinic_users_email_key rejects
-- that regardless of clinic_id, independent of the per-clinic constraint.
--
-- Confirmed no code anywhere in this repo relies on clinic_users.email
-- being globally unique (grepped every services/*.ts file and every
-- migration). The one related check -
-- create_staff_invitation's "this email already belongs to a staff
-- member at another clinic" (migration 0017, ~line 236) - is a separate,
-- intentional application-level rule enforced by its own `exists(...)`
-- query against clinic_users, not this DB constraint, and keeps working
-- completely unchanged after this migration - it is not a database
-- constraint and was never dependent on one.
-- ============================================================

alter table public.clinic_users
  drop constraint if exists clinic_users_email_key;

-- Defensive re-assertion of the real, intended invariant (already added
-- by migration 0017 - safe/idempotent to repeat here in case that
-- migration was ever only partially applied to a given database, the
-- same pattern already seen once this session with
-- create_clinic_with_admin).
alter table public.clinic_users
  drop constraint if exists clinic_users_auth_user_clinic_unique;
alter table public.clinic_users
  add constraint clinic_users_auth_user_clinic_unique unique (auth_user_id, clinic_id);
