-- Billing audit fix #5: DB role-gating (_trigger_guard_role, 0097)
-- controls WHO can touch clinic_invoices/clinic_payments/clinic_charges -
-- that's access control, not history. There is no who/when/before-after
-- trail for a permitted change (a status flip, an amount_paid update, a
-- void). In a cash- and mobile-money-heavy practice, that's exactly the
-- gap that lets a shortfall get quietly papered over.
--
-- Mirrors organization_audit_log's exact tamper-resistance pattern
-- (0033_organization_team_access.sql): no INSERT policy for any client
-- role at all - the only way a row gets written is through the trigger
-- function below, which is security definer. That table was later
-- dropped (0048_remove_multi_branch.sql) during a full rollback and
-- never recreated, so this is a fresh table copying its pattern, not an
-- extension of a live one.
--
-- One generic trigger function, attached to all three tables (TG_TABLE_
-- NAME/TG_OP make it table-agnostic) - confirmed safe to coexist with
-- the existing trg_guard_role_invoices/trg_guard_role_payments (0097):
-- that trigger only ever raises an exception or returns NEW/OLD
-- unchanged, so a second, independent AFTER trigger here needs no
-- coordination with it. clinic_charges has no guard trigger at all
-- today (0097's own comment: every role has a genuine reason to write
-- to it), so this is the first trigger ever added there.
--
-- Placed last (0113) deliberately: every RPC from the three earlier
-- billing-audit fixes (void_invoice, void_payment, add_treatment_
-- deposit, remove_treatment_deposit) is a plain INSERT/UPDATE on these
-- same three tables, so this logs every one of them automatically, with
-- no changes to any of those functions.
--
-- Safe to re-run: create table if not exists, create or replace
-- function, drop trigger if exists + create.

create table if not exists public.financial_audit_log (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null references public.clinics(id) on delete cascade,

  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update')),

  actor_user_id uuid,
  actor_clinic_user_id uuid references public.clinic_users(id) on delete set null,
  actor_role text,

  before_value jsonb,
  after_value jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_financial_audit_log_clinic_record
  on public.financial_audit_log(clinic_id, table_name, record_id, created_at desc);

-- Explicit, defensive grant for a brand-new table read directly by the
-- client (services/financialAuditLog.ts - a plain select, not an RPC).
-- Every existing table in this schema relies on Supabase's project-wide
-- default privileges for this instead (no other migration grants
-- explicitly) - harmless/redundant wherever that already covers it, and
-- the only thing that makes a genuinely new table reliably selectable
-- under RLS in an environment where that default might not (yet) apply.
grant select on public.financial_audit_log to authenticated;

alter table public.financial_audit_log enable row level security;

-- Read-only, Owner/Admin only - matches who can already void/reverse a
-- financial record (0110). No INSERT/UPDATE/DELETE policy for any
-- client role at all, on purpose - see the header comment.
drop policy if exists "financial_audit_log_select_owner_admin" on public.financial_audit_log;
create policy "financial_audit_log_select_owner_admin"
  on public.financial_audit_log for select
  using (
    exists (
      select 1 from public.clinic_users cu
      where cu.auth_user_id = auth.uid()
        and cu.clinic_id = financial_audit_log.clinic_id
        and cu.role in ('Owner', 'Admin')
    )
  );

create or replace function public._log_financial_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_actor_clinic_user_id uuid;
  v_actor_role text;
begin
  v_clinic_id := coalesce(NEW.clinic_id, OLD.clinic_id);

  select cu.id, cu.role into v_actor_clinic_user_id, v_actor_role
  from public.clinic_users cu
  where cu.auth_user_id = auth.uid() and cu.clinic_id = v_clinic_id;

  insert into public.financial_audit_log (
    clinic_id, table_name, record_id, action,
    actor_user_id, actor_clinic_user_id, actor_role,
    before_value, after_value
  ) values (
    v_clinic_id, TG_TABLE_NAME, coalesce(NEW.id, OLD.id), lower(TG_OP),
    auth.uid(), v_actor_clinic_user_id, v_actor_role,
    case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end,
    to_jsonb(NEW)
  );

  return NEW;
end;
$$;

revoke all on function public._log_financial_audit_event() from public;

drop trigger if exists trg_audit_clinic_invoices on public.clinic_invoices;
create trigger trg_audit_clinic_invoices
  after insert or update on public.clinic_invoices
  for each row execute function public._log_financial_audit_event();

drop trigger if exists trg_audit_clinic_payments on public.clinic_payments;
create trigger trg_audit_clinic_payments
  after insert or update on public.clinic_payments
  for each row execute function public._log_financial_audit_event();

drop trigger if exists trg_audit_clinic_charges on public.clinic_charges;
create trigger trg_audit_clinic_charges
  after insert or update on public.clinic_charges
  for each row execute function public._log_financial_audit_event();
