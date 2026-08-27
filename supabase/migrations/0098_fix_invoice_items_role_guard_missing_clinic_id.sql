-- FIN-3.10: CRITICAL FIX for a regression introduced by migration 0097
-- (FIN-3.8's database-level role enforcement). trg_guard_role_invoice_items
-- used the generic _trigger_guard_role() trigger function, which assumes
-- every guarded table has a direct `clinic_id` column
-- (`coalesce(NEW.clinic_id, OLD.clinic_id)`). clinic_invoice_items has NO
-- clinic_id column of its own - it is scoped only via invoice_id ->
-- clinic_invoices.clinic_id. Every write to clinic_invoice_items has
-- therefore been raising "record NEW has no field clinic_id" since 0097
-- was applied, which means every invoice creation with line items
-- (createInvoice, and every other write path that inserts invoice items)
-- has been completely broken in production - not merely over-restricted,
-- a hard crash for every role including Owner.
--
-- Found live via FIN-3.10's 47-branch scale-test data generation (a
-- rolled-back transaction against the live database), which hit this
-- exact error while inserting ordinary invoice line items. Verified no
-- other generically-guarded table (0097's audit) has this same gap -
-- clinic_invoices/clinic_payments/clinic_expenses/clinic_inventory_items/
-- clinic_inventory_movements/clinic_goods_received_notes/clinic_grn_items/
-- clinic_purchase_orders/clinic_purchase_order_items all have a direct
-- clinic_id column and are unaffected.
--
-- Fix: a dedicated guard function for clinic_invoice_items, scoped via its
-- parent invoice's clinic_id (the same "join to the parent" pattern
-- treatment_plan_items already needed for its own, separately-designed
-- guard) - same allowed role set (Owner/Admin/Receptionist) as before,
-- just resolving clinic_id correctly instead of assuming a column that
-- does not exist.

create or replace function public._trigger_guard_invoice_item_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_role text;
begin
  select clinic_id into v_clinic_id
  from public.clinic_invoices
  where id = coalesce(NEW.invoice_id, OLD.invoice_id);

  v_role := public._caller_role(v_clinic_id);

  if v_role is null or v_role not in ('Owner', 'Admin', 'Receptionist') then
    raise exception 'Your role (%) is not authorized to % this record.', coalesce(v_role, 'none'), TG_OP;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_role_invoice_items on public.clinic_invoice_items;
create trigger trg_guard_invoice_item_role
  before insert or update or delete on public.clinic_invoice_items
  for each row execute function public._trigger_guard_invoice_item_role();
