-- Fixes a third instance of the same bug class as migration 0058,
-- discovered while live-verifying that migration: ensure_ledger_
-- provisioned() (0043) - the RPC called at the top of EVERY ledger
-- service function (getLedgerAccounts, getLedgerSettings,
-- getTrialBalance, getProfitAndLoss, getBalanceSheet, ...) to lazily
-- seed a clinic's chart of accounts on first use - resolves "the
-- caller's clinic" with:
--
--   select cu.clinic_id into v_clinic_id from public.clinic_users cu
--   where cu.auth_user_id = v_uid limit 1;
--
-- an arbitrary, unordered pick. For a multi-branch organization member
-- with a clinic_users row per branch, this always resolves to the SAME
-- one branch (whichever Postgres happens to return first) regardless of
-- which branch is actually active - live-verified: after switching to a
-- brand-new second branch and calling ensure_ledger_provisioned(), the
-- new branch's clinic_ledger_accounts stayed completely empty (zero
-- rows) because the RPC provisioned - or in this case, since the first
-- branch was already provisioned, silently no-op'd for - the wrong
-- clinic. Every ledger page for that branch (Trial Balance, P&L,
-- Balance Sheet, even the plain accounts list) would appear permanently
-- empty as a result.
--
-- Fix: same shape as 0058 - add a required p_clinic_id parameter and
-- drop the old zero-arg signature. Unlike 0058's three functions
-- (already re-checked by RLS underneath as `security invoker`), this
-- one is `security definer` (it must be, to seed rows for a
-- not-yet-provisioned clinic on first use) and so does NOT automatically
-- re-check the caller's access - an explicit authorization check is
-- added so a caller can still only ever provision a clinic they
-- genuinely hold a clinic_users row for, preserving the exact same
-- authorization boundary the old (broken but not insecure) version had.
-- _ensure_ledger_provisioned_for_clinic(p_clinic_id) itself already took
-- an explicit clinic id and needs no change.
--
-- services/ledger.ts#ensureLedgerProvisioned is updated in the same
-- change to pass getCurrentClinicId() explicitly, and its in-memory
-- memoization (previously a single `provisioned` boolean, which would
-- also have incorrectly stayed "true" after switching to a different,
-- unprovisioned branch within the same session) is keyed by clinic id.
--
-- Safe to re-run: drop-if-exists + create.

drop function if exists public.ensure_ledger_provisioned();

create or replace function public.ensure_ledger_provisioned(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = v_uid and cu.clinic_id = p_clinic_id
  ) then
    raise exception 'You do not have access to this clinic';
  end if;

  perform public._ensure_ledger_provisioned_for_clinic(p_clinic_id);
end;
$$;

grant execute on function public.ensure_ledger_provisioned(uuid) to authenticated;
