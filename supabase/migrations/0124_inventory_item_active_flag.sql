-- Full-app audit fix H15 (High): no archive/soft-delete for inventory
-- items - the only destructive action available (deleteInventoryItem)
-- either FK-fails with a generic error (if the item was ever ordered via
-- a PO or received via a GRN - clinic_purchase_order_items/
-- clinic_grn_items both reference it `on delete restrict`) or, if never
-- ordered/received, succeeds and cascades away its entire movement/
-- material-usage audit trail (clinic_inventory_movements/
-- treatment_material_usage both `on delete cascade`).
--
-- THE FIX: add an `active` flag (mirroring the existing pattern already
-- used on clinic_suppliers and clinic_expense_categories) so a
-- discontinued item can be hidden from new-consumption/GRN/PO pickers
-- without touching its history at all. Defaults to true so every
-- existing row is unaffected.
--
-- Safe to re-run: add column if not exists.

alter table public.clinic_inventory_items
  add column if not exists active boolean not null default true;

create index if not exists idx_clinic_inventory_items_active
  on public.clinic_inventory_items(clinic_id, active);
