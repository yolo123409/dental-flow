-- WhatsApp Appointment Reminder (manual, click-to-chat) - V1.
--
-- clinic_whatsapp_reminders records only that a receptionist opened a
-- WhatsApp click-to-chat link for a given appointment - never that the
-- message was actually sent, delivered, or read. DentalFlow has no way of
-- knowing more than that from a client-side wa.me link, so don't stretch
-- this table's meaning later without adding real delivery signal first.
--
-- Deliberately SELECT+INSERT only - there is NO update or delete policy,
-- on purpose, matching clinic_inventory_movements (0012). Every row is
-- written once by services/whatsappReminders.ts#recordReminderOpened and
-- never edited afterwards - that's what makes it a trustworthy activity
-- log rather than just another mutable table. Do NOT "fix" a confusing
-- RLS error on this table later by adding update/delete policies.
--
-- Safe to re-run: create table if not exists, drop policy if exists +
-- create, matching every other migration in this folder.

create table if not exists public.clinic_whatsapp_reminders (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  patient_id uuid not null
    references public.patients(id) on delete cascade,

  appointment_id uuid not null
    references public.appointments(id) on delete cascade,

  initiated_by uuid references public.clinic_users(id) on delete set null,

  channel text not null default 'whatsapp' check (channel = 'whatsapp'),

  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_whatsapp_reminders_clinic_id
  on public.clinic_whatsapp_reminders(clinic_id);

create index if not exists idx_clinic_whatsapp_reminders_appointment_id
  on public.clinic_whatsapp_reminders(appointment_id);

create index if not exists idx_clinic_whatsapp_reminders_patient_id
  on public.clinic_whatsapp_reminders(patient_id);

alter table public.clinic_whatsapp_reminders enable row level security;

drop policy if exists "clinic_whatsapp_reminders_select_own_clinic" on public.clinic_whatsapp_reminders;
create policy "clinic_whatsapp_reminders_select_own_clinic"
  on public.clinic_whatsapp_reminders for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_whatsapp_reminders.clinic_id
    )
  );

drop policy if exists "clinic_whatsapp_reminders_insert_own_clinic" on public.clinic_whatsapp_reminders;
create policy "clinic_whatsapp_reminders_insert_own_clinic"
  on public.clinic_whatsapp_reminders for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = clinic_whatsapp_reminders.clinic_id
    )
  );
