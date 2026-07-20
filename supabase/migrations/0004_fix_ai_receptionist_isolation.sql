-- The AI receptionist feature (app/admin/receptionist, app/admin/
-- playground, app/api/ai) had NO tenant scoping at all:
--
-- - ai_receptionists: app/admin/receptionist/page.tsx read/wrote via
--   `.limit(1).single()` with no clinic filter - every clinic that opened
--   this settings page would read AND OVERWRITE the same single global
--   row. The first clinic to save wins; every other clinic silently gets
--   (and can clobber) someone else's AI configuration.
-- - ai_conversations: app/admin/playground/page.tsx loaded and displayed
--   `select("*").order("created_at")` with no filter at all - every
--   clinic's playground showed every other clinic's conversation
--   history. Worse, "Clear Chat" ran `.delete().neq("id","")`, i.e.
--   deletes every row for every clinic on a single click.
-- - app/api/ai/route.ts used the service-role client (bypasses RLS) to
--   fetch `ai_receptionists` with no clinic filter, and had no
--   authentication check of any kind - open to the entire internet.
--
-- This migration adds clinic_id to both tables. Both are near-empty in
-- production (ai_receptionists: 0 rows: ai_conversations: 1 orphaned
-- test row with no clinic to attribute it to, deleted below), so this is
-- a safe direct NOT NULL add with no real backfill.

delete from public.ai_conversations;

alter table public.ai_receptionists
  add column if not exists clinic_id uuid references public.clinics(id);

alter table public.ai_conversations
  add column if not exists clinic_id uuid references public.clinics(id);

do $$
begin
  if not exists (select 1 from public.ai_receptionists where clinic_id is null) then
    alter table public.ai_receptionists alter column clinic_id set not null;
  end if;

  if not exists (select 1 from public.ai_conversations where clinic_id is null) then
    alter table public.ai_conversations alter column clinic_id set not null;
  end if;
end $$;

-- One receptionist config per clinic
alter table public.ai_receptionists
  drop constraint if exists ai_receptionists_clinic_id_key;
alter table public.ai_receptionists
  add constraint ai_receptionists_clinic_id_key unique (clinic_id);

alter table public.ai_receptionists enable row level security;

drop policy if exists "ai_receptionists_all_own_clinic" on public.ai_receptionists;
create policy "ai_receptionists_all_own_clinic"
  on public.ai_receptionists for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = ai_receptionists.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = ai_receptionists.clinic_id
    )
  );

alter table public.ai_conversations enable row level security;

drop policy if exists "ai_conversations_all_own_clinic" on public.ai_conversations;
create policy "ai_conversations_all_own_clinic"
  on public.ai_conversations for all
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = ai_conversations.clinic_id
    )
  )
  with check (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = ai_conversations.clinic_id
    )
  );
