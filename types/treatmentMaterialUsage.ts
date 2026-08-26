/**
 * FIN-2: materials actually consumed for one real treatment instance
 * (treatment_plan_items - see services/treatmentMaterialUsage.ts). One row
 * per (treatment, inventory item) - migration 0088's
 * treatment_material_usage table holds only the CURRENT state; the
 * immutable audit trail and its automatic ledger postings remain
 * clinic_inventory_movements (0012/0042/0043), unchanged.
 */
export interface TreatmentMaterialUsage {
  id: string;

  clinic_id: string;
  treatment_plan_item_id: string;
  inventory_item_id: string;

  quantity: number;

  /** Weighted-average cost across this line's own consumption events -
   * never the inventory item's live cost_per_unit read at display time.
   * See migration 0088's header comment. */
  unit_cost: number;

  created_by: string | null;

  created_at: string;
  updated_at: string;

  clinic_inventory_items?: {
    name: string;
    unit: string;
  } | null;
}
