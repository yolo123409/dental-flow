-- Clinic Profile hardening: RLS defense-in-depth + real, committed access
-- control for the clinic-assets Storage bucket.
--
-- Two confirmed, live gaps closed here:
--   1. clinics/clinic_settings UPDATE policies had `using` but no
--      `with check` - adding it is defense-in-depth, no behavior change
--      for legitimate admin/owner updates.
--   2. The clinic-assets bucket (clinic logos) had ZERO committed access
--      policy anywhere in this repo - it was configured directly in the
--      Supabase dashboard and was unverifiable. This adds real, path-scoped
--      policies mirroring the existing patient-files pattern (migration
--      0003): any clinic member can read their own clinic's objects
--      (authenticated API surface only - the public getPublicUrl() route
--      bypasses RLS for reads on a public bucket, which is required for
--      the logo to render in invoices/PDFs), and only that clinic's
--      Owner/Admin can insert/update/delete them. Four separate policies,
--      not one `for all`, since the JS client's upload(..., {upsert:true})
--      can resolve to either an insert or an update internally.
--
-- Also adds a unique constraint on clinic_settings.clinic_id (one row per
-- clinic) - safe to add now since no INSERT policy has ever existed on
-- this table, so no duplicate rows can exist yet.
--
-- Safe to re-run: drop policy if exists / create-or-replace throughout,
-- matching every other migration in this folder.

-- ============================================================
-- 1. with check on the existing UPDATE-only policies
-- ============================================================

drop policy if exists "clinics_update_admin_only" on public.clinics;
create policy "clinics_update_admin_only"
  on public.clinics for update
  using (public.is_clinic_owner_or_admin(clinics.id))
  with check (public.is_clinic_owner_or_admin(clinics.id));

drop policy if exists "clinic_settings_update_admin_only" on public.clinic_settings;
create policy "clinic_settings_update_admin_only"
  on public.clinic_settings for update
  using (public.is_clinic_owner_or_admin(clinic_settings.clinic_id))
  with check (public.is_clinic_owner_or_admin(clinic_settings.clinic_id));

-- ============================================================
-- 2. One clinic_settings row per clinic
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinic_settings_clinic_id_key'
  ) then
    alter table public.clinic_settings
      add constraint clinic_settings_clinic_id_key unique (clinic_id);
  end if;
end $$;

-- ============================================================
-- 3. clinic-assets bucket: create-or-harden. `do update` (not `do
--    nothing`) because the bucket already exists via the dashboard -
--    `do nothing` would make this whole block a no-op.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-assets',
  'clinic-assets',
  true,
  2097152, -- 2MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 4. clinic-assets storage.objects policies
--    Object paths are `${clinicId}/logo.${extension}` - the first path
--    segment (storage.foldername(name))[1] is the owning clinic's id.
-- ============================================================

drop policy if exists "clinic_assets_select_own_clinic" on storage.objects;
create policy "clinic_assets_select_own_clinic"
  on storage.objects for select
  using (
    bucket_id = 'clinic-assets'
    and exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "clinic_assets_insert_admin_only" on storage.objects;
create policy "clinic_assets_insert_admin_only"
  on storage.objects for insert
  with check (
    bucket_id = 'clinic-assets'
    and public.is_clinic_owner_or_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clinic_assets_update_admin_only" on storage.objects;
create policy "clinic_assets_update_admin_only"
  on storage.objects for update
  using (
    bucket_id = 'clinic-assets'
    and public.is_clinic_owner_or_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'clinic-assets'
    and public.is_clinic_owner_or_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clinic_assets_delete_admin_only" on storage.objects;
create policy "clinic_assets_delete_admin_only"
  on storage.objects for delete
  using (
    bucket_id = 'clinic-assets'
    and public.is_clinic_owner_or_admin(((storage.foldername(name))[1])::uuid)
  );
