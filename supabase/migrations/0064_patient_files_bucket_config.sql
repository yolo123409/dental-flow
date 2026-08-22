-- Found during a production-hardening audit: unlike clinic-assets (0010)
-- and expense-receipts (0028), the patient-files bucket has never had an
-- explicit `insert into storage.buckets` in any tracked migration - its
-- public flag, size limit, and allowed MIME types have only ever existed
-- as whatever was clicked together in the dashboard, which is both
-- unverifiable from this repo and one accidental dashboard toggle away
-- from bypassing every storage.objects RLS policy already in place for
-- it (0003_fix_patient_teeth_and_attachments_isolation.sql - RLS on
-- storage.objects only governs the authenticated API path; a bucket
-- flipped to `public = true` serves objects directly over its CDN URL,
-- with no RLS check at all).
--
-- This makes that configuration explicit and version-controlled, using
-- the same `on conflict (id) do update` pattern as 0010/0028 (safe
-- whether the bucket already exists from the dashboard or not).
-- Deliberately private (patient documents are never appropriate to
-- serve from a public URL), and matches the exact allowed-type set
-- already established for expense-receipts (0028) - PDF plus the three
-- common image formats - since "Patient Documents" is the same kind of
-- scanned-form/photo upload, just for a different record type.
--
-- Existing storage.objects RLS policies for this bucket (0003) are
-- untouched - only the bucket row's own metadata changes here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files',
  'patient-files',
  false,
  10485760, -- 10MB - patient documents can be larger multi-page scans
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
