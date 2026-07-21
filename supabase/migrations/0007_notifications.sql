-- Notification system backing the header notification bell. A notification
-- either targets one staff member (user_id set, e.g. "your role changed")
-- or the whole clinic (user_id null, e.g. "new patient registered" - seen
-- by every staff member until read). Follows the exact conventions already
-- established in this schema: uuid PK with gen_random_uuid(), clinic_id FK
-- + NOT NULL + indexed, app-level created_at (no triggers, matching every
-- other table here), and the same clinic-membership EXISTS policy shape as
-- every RLS policy added in earlier migrations.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  -- Null = clinic-wide notification, visible to every staff member.
  user_id uuid references public.clinic_users(id) on delete cascade,

  title text not null,
  message text not null,

  -- patient | appointment | billing | staff | treatment_plan | system
  type text not null default 'system',

  -- Optional link back to the record this notification is about, e.g.
  -- entity_type = 'patient', entity_id = patients.id.
  entity_type text,
  entity_id uuid,

  read boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_clinic_id on public.notifications(clinic_id);
create index if not exists idx_notifications_user_id on public.notifications(user_id);

-- Powers "latest 20 for this clinic" and "unread count" lookups.
create index if not exists idx_notifications_clinic_created_at on public.notifications(clinic_id, created_at desc);
create index if not exists idx_notifications_clinic_unread on public.notifications(clinic_id, read) where read = false;

alter table public.notifications enable row level security;

-- Any clinic member may create a notification scoped to their own clinic,
-- whether it's addressed to themselves, another staff member, or the whole
-- clinic (user_id null) - mirrors how treatment_plans.created_by is set
-- client-side today.
drop policy if exists "notifications_insert_own_clinic" on public.notifications;
create policy "notifications_insert_own_clinic"
  on public.notifications for insert
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = notifications.clinic_id
    )
  );

-- A clinic member can only see/update/delete notifications that are either
-- clinic-wide or addressed to them specifically.
drop policy if exists "notifications_select_own_clinic" on public.notifications;
create policy "notifications_select_own_clinic"
  on public.notifications for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = notifications.clinic_id
        and (notifications.user_id is null or notifications.user_id = cu.id)
    )
  );

drop policy if exists "notifications_update_own_clinic" on public.notifications;
create policy "notifications_update_own_clinic"
  on public.notifications for update
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = notifications.clinic_id
        and (notifications.user_id is null or notifications.user_id = cu.id)
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = notifications.clinic_id
        and (notifications.user_id is null or notifications.user_id = cu.id)
    )
  );

drop policy if exists "notifications_delete_own_clinic" on public.notifications;
create policy "notifications_delete_own_clinic"
  on public.notifications for delete
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = notifications.clinic_id
        and (notifications.user_id is null or notifications.user_id = cu.id)
    )
  );
