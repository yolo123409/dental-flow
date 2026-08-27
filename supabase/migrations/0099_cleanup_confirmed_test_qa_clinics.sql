-- FIN-4.3: safe cleanup of confirmed test/QA artifacts, identified by a
-- full cross-table audit - every one of the 47 tables with a clinic_id
-- column was checked for each candidate clinic (see FIN-4.3's report).
-- Every clinic deleted here has ZERO financial or clinical data: no
-- invoices, payments, expenses, ledger transactions, ledger accounts/
-- settings, or staff invitations anywhere. The only rows any of them own
-- are auto-provisioned defaults (clinic_roles/clinic_settings) or, for
-- "QA Pagination Scale Test", exactly the synthetic patients its own
-- name says it is.
--
-- NOT included here (deliberately left alone pending human
-- confirmation - this phase's own rule is to never guess on an
-- ambiguous record): "DentalFlow Demo Clinic" (real six-week usage
-- history, 45 invoices, 85 ledger transactions), "Gecko" (a real staff
-- assignment to a real-looking email, zero activity otherwise), and
-- "westlands"/"parklands" (organization "smiley" - parklands has real,
-- if small, financial/ledger activity). See FIN-4.3's report for the
-- full classification of every clinic in the database.
--
-- THIS MIGRATION IS NOT APPLIED AUTOMATICALLY. Re-run the audit before
-- applying it if meaningful time has passed - this reflects what was
-- true when FIN-4.3 was written (2026-08-27), not necessarily what's
-- true when this runs. Every statement is scoped by exact id and is a
-- no-op (0 rows affected, not an error) if a row is already gone.

-- Dentistcity - empty shell: zero staff, zero clinical/financial
-- activity, only the auto-provisioned defaults.
delete from clinic_roles where clinic_id = '812f4504-7158-45a0-bd97-cbf281eb1d6f';
delete from clinic_settings where clinic_id = '812f4504-7158-45a0-bd97-cbf281eb1d6f';
delete from clinics where id = '812f4504-7158-45a0-bd97-cbf281eb1d6f';

-- Three clinics sharing an obvious auto-generated timestamp suffix
-- (1786557318931), created within ~1 second of each other, with
-- literally zero rows in any clinic-scoped table - not even the
-- normally-auto-provisioned defaults, meaning these were inserted
-- directly rather than through the app's real clinic-creation path.
delete from clinics where id in (
  'bf9db69a-f5dd-4ef2-9e37-fad8c6ec1260', -- Westlands 1786557318931
  '372f5e1b-3dcf-4cdd-b663-81d54583abe9', -- Utawala 1786557318931
  'bfe7a5a3-55c0-4797-8a91-df337a2617c6'  -- Outside Clinic 1786557318931
);

-- "q" - clinic named a single letter; its one staff member's full_name
-- is "w" - an unambiguous placeholder/throwaway test input, zero
-- clinical/financial activity. That person's email
-- (billsburgerssss@gmail.com) also legitimately owns two OTHER clinics
-- (westlands/parklands, organization "smiley", NOT touched here) -
-- deleting this clinic's own clinic_users row only removes their
-- membership in THIS one throwaway clinic, never their real access
-- elsewhere (clinic_users is one row per clinic membership, not a
-- single global identity row).
delete from clinic_users where clinic_id = '982ad142-78f4-4f32-b856-9d4eab55509f';
delete from clinic_roles where clinic_id = '982ad142-78f4-4f32-b856-9d4eab55509f';
delete from clinic_settings where clinic_id = '982ad142-78f4-4f32-b856-9d4eab55509f';
delete from clinics where id = '982ad142-78f4-4f32-b856-9d4eab55509f';

-- "QA Pagination Scale Test" - self-labeled by its own name, 130
-- synthetic patients and nothing else (zero appointments, invoices,
-- payments, expenses, or ledger activity anywhere in this clinic).
delete from patients where clinic_id = 'cf9b5b4d-d076-493f-b1f5-850faca18325';
delete from clinics where id = 'cf9b5b4d-d076-493f-b1f5-850faca18325';
