-- Production Readiness 2.0, Section 4 (live storage.objects policy
-- inventory) found a critical, currently-live cross-tenant leak on the
-- patient-files bucket (X-rays, patient documents).
--
-- storage.objects has 5 policies scoped to bucket_id = 'patient-files':
--   1. "Authenticated users can view files"   (SELECT, roles=authenticated)
--   2. "Authenticated users can upload files" (INSERT, roles=authenticated)
--   3. "Authenticated users can update files" (UPDATE, roles=authenticated)
--   4. "Authenticated users can delete files" (DELETE, roles=authenticated)
--   5. "patient_files_all_own_clinic" (ALL, roles=public) - added by
--      migration 0003_fix_patient_teeth_and_attachments_isolation.sql,
--      correctly scoped to the requesting user's own clinic via a
--      patients/clinic_users join.
--
-- Policies 1-4 do not exist in any migration in this repo - their exact
-- names match Supabase Dashboard's built-in "New Policy" quick-start
-- templates, so they were created directly in Studio, not through this
-- migration history, and predate or were simply missed by 0003's fix.
-- They check nothing beyond bucket_id, no clinic/patient scoping at all.
--
-- Postgres OR's together multiple permissive policies for the same
-- command - so despite policy 5 being correct, policies 1-4 individually
-- grant every authenticated user (of ANY clinic) full read/write/delete
-- access to every other clinic's patient-files objects. Confirmed live
-- by cross-referencing the actual pg_policies definitions before writing
-- this fix.
--
-- Fix: drop policies 1-4. Policy 5 alone already covers every legitimate
-- access pattern (SELECT/INSERT/UPDATE/DELETE, same-clinic-only) for
-- this bucket, so no behavior changes for any legitimate user - only the
-- cross-tenant hole closes.
drop policy if exists "Authenticated users can view files" on storage.objects;
drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Authenticated users can update files" on storage.objects;
drop policy if exists "Authenticated users can delete files" on storage.objects;
