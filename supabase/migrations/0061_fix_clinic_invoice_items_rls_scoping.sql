-- Fixes the same wrong-column RLS bug already fixed on patients (0057)
-- and clinic_invoices/clinic_charges/clinic_payments/clinic_treatments/
-- patient_tooth_files/patient_tooth_folders/patient_tooth_history/
-- patient_notes/patient_teeth/treatments (0060), now found on
-- clinic_invoice_items: all four existing policies ("Invoice Items
-- Select/Insert/Update/Delete") authorize via
--   clinic_invoices.clinic_id in (select clinic_users.clinic_id
--                                 from clinic_users
--                                 where clinic_users.id = auth.uid())
-- comparing clinic_users.id (that table's own generated primary key) to
-- auth.uid(), instead of clinic_users.auth_user_id = auth.uid(). Since
-- clinic_users.id is no longer set equal to the owner's auth_user_id
-- (it became an independently-generated UUID once multi-staff/
-- multi-branch clinics needed one clinic_users row per person), this
-- subquery returns no rows for any real logged-in user, so every
-- policy fails closed - manifesting as
-- "new row violates row-level security policy for table
-- clinic_invoice_items" on invoice creation, and equivalent denial on
-- read/update/delete.
--
-- clinic_invoice_items has no clinic_id column of its own (confirmed
-- directly against the live table) - createInvoice() only ever inserts
-- invoice_id/treatment_name/quantity/unit_price/total_price - so
-- authorization is necessarily derived by joining through
-- clinic_invoices.clinic_id via invoice_id, exactly as the existing
-- (broken) policies already attempted. That join/parent-authorization
-- logic is preserved unchanged here; only the membership subquery's
-- comparison column is corrected, matching the pattern the newer
-- policies on clinic_invoices/clinic_charges/dentists already use.
--
-- Unlike 0060's additive approach (which left the old broken policies
-- in place, since they were merely non-functional rather than a leak),
-- this replaces the four existing policies in place, using their
-- existing names - the broken subquery here can never match a real
-- user, so there is nothing a same-named replacement could regress,
-- and it avoids leaving dead, confusing policy cruft on a table that
-- was just being actively debugged.
--
-- Safe to re-run: drop policy if exists + create policy is idempotent.

drop policy if exists "Invoice Items Select" on public.clinic_invoice_items;
create policy "Invoice Items Select"
  on public.clinic_invoice_items for select
  using (
    exists (
      select 1
      from public.clinic_invoices
      where (
        clinic_invoices.id = clinic_invoice_items.invoice_id
        and clinic_invoices.clinic_id in (
          select clinic_users.clinic_id
          from public.clinic_users
          where clinic_users.auth_user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Invoice Items Insert" on public.clinic_invoice_items;
create policy "Invoice Items Insert"
  on public.clinic_invoice_items for insert
  with check (
    exists (
      select 1
      from public.clinic_invoices
      where (
        clinic_invoices.id = clinic_invoice_items.invoice_id
        and clinic_invoices.clinic_id in (
          select clinic_users.clinic_id
          from public.clinic_users
          where clinic_users.auth_user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Invoice Items Update" on public.clinic_invoice_items;
create policy "Invoice Items Update"
  on public.clinic_invoice_items for update
  using (
    exists (
      select 1
      from public.clinic_invoices
      where (
        clinic_invoices.id = clinic_invoice_items.invoice_id
        and clinic_invoices.clinic_id in (
          select clinic_users.clinic_id
          from public.clinic_users
          where clinic_users.auth_user_id = auth.uid()
        )
      )
    )
  )
  with check (
    exists (
      select 1
      from public.clinic_invoices
      where (
        clinic_invoices.id = clinic_invoice_items.invoice_id
        and clinic_invoices.clinic_id in (
          select clinic_users.clinic_id
          from public.clinic_users
          where clinic_users.auth_user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Invoice Items Delete" on public.clinic_invoice_items;
create policy "Invoice Items Delete"
  on public.clinic_invoice_items for delete
  using (
    exists (
      select 1
      from public.clinic_invoices
      where (
        clinic_invoices.id = clinic_invoice_items.invoice_id
        and clinic_invoices.clinic_id in (
          select clinic_users.clinic_id
          from public.clinic_users
          where clinic_users.auth_user_id = auth.uid()
        )
      )
    )
  );
