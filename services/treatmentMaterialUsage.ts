import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import { TreatmentMaterialUsage } from "@/types/treatmentMaterialUsage";

/**
 * FIN-2: materials actually consumed for one real treatment instance
 * (treatment_plan_items, not the clinic_treatments catalog - see migration
 * 0088's header comment for the full architectural reasoning). Every
 * mutation goes through add_treatment_material/
 * update_treatment_material_quantity, which atomically check stock,
 * insert exactly one clinic_inventory_movements row per delta, and let
 * the existing ledger trigger (0043) post COGS - nothing here duplicates
 * that posting.
 *
 * Uses the same permission as every other inventory-consuming action
 * (recordConsumption in services/inventory.ts) - "inventory_manage"
 * (Owner/Admin/Receptionist). A Dentist can still VIEW what materials were
 * recorded (getTreatmentMaterialUsage needs no special permission beyond
 * clinic membership, matching every other read in this codebase), but
 * cannot add/edit them - this reuses the existing inventory permission
 * model exactly rather than inventing a new one, per the FIN-2 brief's
 * "do not invent a new stock policy" instruction.
 */

const MATERIAL_USAGE_SELECT = `
  *,
  clinic_inventory_items ( name, unit )
`;

export async function getTreatmentMaterialUsage(
  treatmentPlanItemId: string
): Promise<TreatmentMaterialUsage[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_material_usage")
    .select(MATERIAL_USAGE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("treatment_plan_item_id", treatmentPlanItemId)
    .order("created_at");

  if (error) {
    logError("[treatmentMaterialUsage] getTreatmentMaterialUsage failed:", error);

    throw toError(error);
  }

  return (data ?? []) as unknown as TreatmentMaterialUsage[];
}

export async function addTreatmentMaterial(
  treatmentPlanItemId: string,
  inventoryItemId: string,
  quantity: number,
  notes?: string
): Promise<TreatmentMaterialUsage> {
  await assertPermission("inventory_manage");

  if (quantity <= 0) {
    throw new Error("Enter a quantity greater than 0.");
  }

  const { data, error } = await supabase.rpc("add_treatment_material", {
    p_treatment_plan_item_id: treatmentPlanItemId,
    p_inventory_item_id: inventoryItemId,
    p_quantity: quantity,
    p_notes: notes ?? null,
  });

  if (error) {
    logError("[treatmentMaterialUsage] addTreatmentMaterial failed:", error);

    throw toError(error);
  }

  return data as TreatmentMaterialUsage;
}

/**
 * Reconciles a line to a new total quantity - an increase consumes only
 * the delta, a decrease reverses only the delta (0 removes the line
 * entirely), never re-posting the whole new total. See migration 0088's
 * update_treatment_material_quantity for the atomic implementation.
 */
export async function updateTreatmentMaterialQuantity(
  usageId: string,
  newQuantity: number
): Promise<TreatmentMaterialUsage | null> {
  await assertPermission("inventory_manage");

  if (newQuantity < 0) {
    throw new Error("Quantity cannot be negative.");
  }

  const { data, error } = await supabase.rpc(
    "update_treatment_material_quantity",
    {
      p_usage_id: usageId,
      p_new_quantity: newQuantity,
    }
  );

  if (error) {
    logError(
      "[treatmentMaterialUsage] updateTreatmentMaterialQuantity failed:",
      error
    );

    throw toError(error);
  }

  return data as TreatmentMaterialUsage | null;
}

export async function removeTreatmentMaterial(usageId: string): Promise<void> {
  await updateTreatmentMaterialQuantity(usageId, 0);
}
