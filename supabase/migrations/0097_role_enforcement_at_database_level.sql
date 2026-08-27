-- FIN-3.8: move role-based authorization (Owner/Admin/Dentist/Receptionist)
-- into the database for financial, inventory, and treatment mutations -
-- today enforced ONLY by the application (lib/permissions.ts's
-- canAccess()/assertPermission(), checked in services/*.ts before a
-- Supabase call is made). Every RLS policy audited before writing this
-- migration checks CLINIC membership only (`cu.auth_user_id = auth.uid()
-- AND cu.clinic_id = X`) with zero role distinction, on every table
-- surveyed except clinic_ledger_accounts/clinic_ledger_settings/
-- clinic_users (already correctly Owner/Admin-gated). A direct Supabase
-- client call from any authenticated clinic member - any role - can
-- bypass the app's own role checks entirely today.
--
-- METHOD: rather than rewriting the financial/inventory/procurement
-- tables' existing RLS policies (several have intricate, already-correct
-- cross-table validation - GRN/PO Draft-status guards, supplier/category
-- validity, etc. - that would be needlessly risky to touch), this adds a
-- BEFORE INSERT/UPDATE/DELETE trigger per table that independently checks
-- the caller's role and raises an exception if it isn't in the allowed
-- set. A trigger fires in addition to RLS, never in place of it - nothing
-- existing is weakened or removed, only a new gate added on top.
--
-- ROLE SETS (matching lib/permissions.ts's Permission grants exactly, not
-- invented): financial (billing/money_out_manage) and inventory
-- (inventory_manage/procurement_manage) are both Owner+Admin+Receptionist
-- - Dentist has neither permission. This exactly matches the role check
-- already hardcoded inside adjust_inventory_stock/confirm_grn_receipt/
-- add_treatment_material/update_treatment_material_quantity (migrations
-- 0042/0025/0088) - this migration brings the RAW TABLE access up to the
-- same bar those RPCs already enforce, closing the bypass where writing
-- directly to clinic_inventory_items/clinic_grn_items/etc. skips the
-- RPC's own role check entirely.
--
-- clinic_charges and patients/patient_teeth are deliberately NOT
-- role-gated here: every role in the system (Owner/Admin/Dentist/
-- Receptionist) has a genuine reason to write to them (a Dentist stages a
-- charge by creating a Treatment; a Receptionist stages one by billing;
-- every role needs patient access) - a role restriction there would be a
-- no-op at best and a functional regression at worst.
--
-- treatment_plans/treatment_plan_items/treatment_teeth get their own,
-- more careful guard below (not the generic one) because two DIFFERENT
-- roles legitimately write to treatment_plan_items for two DIFFERENT
-- reasons: a Dentist creates/edits the clinical content
-- (procedure/price/quantity/teeth), while a Receptionist's
-- billTreatmentPlanItems() legitimately sets charge_id, and
-- reorderTreatmentItems() (ungated even at the app level today, treated
-- as low-risk/cosmetic) sets sort_order. A blanket Dentist-only lock
-- would have broken both of those real, currently-working flows -
-- confirmed by reading every write path in services/treatmentPlans.ts and
-- services/treatmentTeeth.ts before writing this migration, not assumed.
--
-- ALSO FOUND while tracing those write paths: createTreatmentPlan/
-- updateTreatmentPlan/deleteTreatmentPlan/updateTreatmentItem/
-- deleteTreatmentItem/removeTreatmentTooth/replaceTreatmentTeeth call NO
-- assertPermission() at all today - not a database gap, an APPLICATION
-- gap (the one exception is billTreatmentPlanItems, which does check
-- "billing"). This migration closes the database side; the application
-- side is closed in the same commit by adding the missing
-- assertPermission("treatments") calls to those service functions
-- (services/treatmentPlans.ts, services/treatmentTeeth.ts) - a genuinely
-- missing check being added, not a working one being removed or altered.

/* ============================================================ */
/* 0. Shared role-lookup helper                                   */
/* ============================================================ */

create or replace function public._caller_role(p_clinic_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select cu.role from public.clinic_users cu
  where cu.auth_user_id = auth.uid() and cu.clinic_id = p_clinic_id
  limit 1;
$$;

/* ============================================================ */
/* 1. Generic role-guard trigger, parameterized by allowed roles  */
/*    at CREATE TRIGGER time via TG_ARGV.                         */
/* ============================================================ */

create or replace function public._trigger_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_role text;
begin
  v_clinic_id := coalesce(NEW.clinic_id, OLD.clinic_id);
  v_role := public._caller_role(v_clinic_id);

  if v_role is null or not (v_role = any(TG_ARGV)) then
    raise exception 'Your role (%) is not authorized to % this record.', coalesce(v_role, 'none'), TG_OP;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;

-- Financial: Owner/Admin/Receptionist (matches "billing"/"money_out_manage").
drop trigger if exists trg_guard_role_invoices on public.clinic_invoices;
create trigger trg_guard_role_invoices
  before insert or update on public.clinic_invoices
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_invoice_items on public.clinic_invoice_items;
create trigger trg_guard_role_invoice_items
  before insert or update or delete on public.clinic_invoice_items
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_payments on public.clinic_payments;
create trigger trg_guard_role_payments
  before insert on public.clinic_payments
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_expenses on public.clinic_expenses;
create trigger trg_guard_role_expenses
  before insert or update on public.clinic_expenses
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

-- Inventory/procurement: Owner/Admin/Receptionist (matches
-- "inventory_manage"/"procurement_manage" and the role checks already
-- hardcoded inside adjust_inventory_stock/confirm_grn_receipt/
-- add_treatment_material/update_treatment_material_quantity).
drop trigger if exists trg_guard_role_inventory_items on public.clinic_inventory_items;
create trigger trg_guard_role_inventory_items
  before insert or update or delete on public.clinic_inventory_items
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_inventory_movements on public.clinic_inventory_movements;
create trigger trg_guard_role_inventory_movements
  before insert on public.clinic_inventory_movements
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_grns on public.clinic_goods_received_notes;
create trigger trg_guard_role_grns
  before insert or update on public.clinic_goods_received_notes
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_grn_items on public.clinic_grn_items;
create trigger trg_guard_role_grn_items
  before insert or update or delete on public.clinic_grn_items
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_purchase_orders on public.clinic_purchase_orders;
create trigger trg_guard_role_purchase_orders
  before insert or update on public.clinic_purchase_orders
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

drop trigger if exists trg_guard_role_purchase_order_items on public.clinic_purchase_order_items;
create trigger trg_guard_role_purchase_order_items
  before insert or update or delete on public.clinic_purchase_order_items
  for each row execute function public._trigger_guard_role('Owner', 'Admin', 'Receptionist');

/* ============================================================ */
/* 2. Treatment tables: Owner/Admin/Dentist, with narrow carve-   */
/*    outs for the specific columns Receptionist's billing/       */
/*    reorder flows legitimately touch.                           */
/* ============================================================ */

create or replace function public._trigger_guard_treatment_plan_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public._caller_role(coalesce(NEW.clinic_id, OLD.clinic_id));

  if v_role in ('Owner', 'Admin', 'Dentist') then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  -- Any other role (Receptionist, or none): only an UPDATE that changes
  -- nothing but updated_at is allowed - touchPlan() is called from
  -- billTreatmentPlanItems() (a "billing"-permission Receptionist flow)
  -- and from reorderTreatmentItems() (ungated even at the app level,
  -- purely cosmetic) - neither ever changes title/notes/status/patient_id.
  if TG_OP = 'UPDATE'
    and NEW.title is not distinct from OLD.title
    and NEW.notes is not distinct from OLD.notes
    and NEW.status is not distinct from OLD.status
    and NEW.patient_id is not distinct from OLD.patient_id
  then
    return NEW;
  end if;

  raise exception 'Only Owner, Admin, or Dentist can create, delete, or edit a treatment plan.';
end;
$$;

drop trigger if exists trg_guard_treatment_plan_role on public.treatment_plans;
create trigger trg_guard_treatment_plan_role
  before insert or update or delete on public.treatment_plans
  for each row execute function public._trigger_guard_treatment_plan_role();

create or replace function public._trigger_guard_treatment_plan_item_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public._caller_role(coalesce(NEW.clinic_id, OLD.clinic_id));

  if v_role in ('Owner', 'Admin', 'Dentist') then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  -- Any other role: only an UPDATE that changes nothing but
  -- charge_id/sort_order/updated_at is allowed - billTreatmentPlanItems()
  -- (Receptionist, "billing") only ever sets charge_id;
  -- reorderTreatmentItems() (ungated, cosmetic) only ever sets sort_order.
  if TG_OP = 'UPDATE'
    and NEW.treatment_plan_id is not distinct from OLD.treatment_plan_id
    and NEW.procedure is not distinct from OLD.procedure
    and NEW.tooth_number is not distinct from OLD.tooth_number
    and NEW.estimated_price is not distinct from OLD.estimated_price
    and NEW.quantity is not distinct from OLD.quantity
    and NEW.notes is not distinct from OLD.notes
    and NEW.priority is not distinct from OLD.priority
    and NEW.status is not distinct from OLD.status
  then
    return NEW;
  end if;

  raise exception 'Only Owner, Admin, or Dentist can create, delete, or edit a treatment plan item''s clinical or pricing fields.';
end;
$$;

drop trigger if exists trg_guard_treatment_plan_item_role on public.treatment_plan_items;
create trigger trg_guard_treatment_plan_item_role
  before insert or update or delete on public.treatment_plan_items
  for each row execute function public._trigger_guard_treatment_plan_item_role();

create or replace function public._trigger_guard_treatment_teeth_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public._caller_role(coalesce(NEW.clinic_id, OLD.clinic_id));

  if v_role not in ('Owner', 'Admin', 'Dentist') then
    raise exception 'Only Owner, Admin, or Dentist can modify a treatment''s tooth associations.';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_treatment_teeth_role on public.treatment_teeth;
create trigger trg_guard_treatment_teeth_role
  before insert or update or delete on public.treatment_teeth
  for each row execute function public._trigger_guard_treatment_teeth_role();
