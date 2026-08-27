import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import {
  isValidTooth,
  isValidPrimaryTooth,
} from "@/components/patients/dental/toothSelection";

import { TreatmentPlanItem } from "@/types/treatmentPlan";

/**
 * Treatment <-> Teeth relationship (migration 0072_treatment_teeth.sql) -
 * Phase A of the Treatment/Procedure architecture redesign. Purely
 * additive: treatment_plan_items.tooth_number is untouched and remains
 * the compatibility field, and nothing here is wired into any UI yet -
 * this is the foundation Phase B builds the multi-tooth treatment
 * workflow on. Never touches clinic_charges/clinic_invoices; this table
 * is a clinical association only.
 */

/**
 * Validates against real FDI tooth codes - permanent (11-18, 21-28,
 * 31-38, 41-48) via isValidTooth(), or primary/deciduous (51-55, 61-65,
 * 71-75, 81-85) via isValidPrimaryTooth() - the same functions the
 * odontogram itself uses, not a plain numeric range. A naive 1-32 bound
 * (what this function originally used) silently rejects every FDI code
 * above 32 - all of quadrant 4 (41-48) and most of quadrant 3 (33-38) -
 * which is most of the lower arch; found via Phase C's own tests failing
 * on tooth 36 (see migration 0074's matching database-level fix).
 *
 * FIN-3.8: also accepts primary teeth - this function was still
 * permanent-only after FIN-3.7 widened treatment_teeth's own database
 * CHECK constraint, so a primary-tooth Treatment would have been rejected
 * here, in the application layer, before ever reaching the database that
 * phase fixed. Found while auditing this same file for FIN-3.8's
 * database-level role-enforcement pass, corrected as part of it since
 * it's the same "primary dentition through the Treatment Plan path"
 * defect FIN-3.7 set out to close.
 */
export function assertValidToothNumbers(toothNumbers: number[]): void {
  if (toothNumbers.length === 0) {
    throw new Error("At least one tooth number is required.");
  }

  for (const tooth of toothNumbers) {
    if (
      !Number.isInteger(tooth) ||
      (!isValidTooth(tooth) && !isValidPrimaryTooth(tooth))
    ) {
      throw new Error(
        `Tooth number ${tooth} is invalid - must be a real FDI tooth number (permanent: 11-18, 21-28, 31-38, 41-48; primary: 51-55, 61-65, 71-75, 81-85).`
      );
    }
  }
}

/* -------------------------------------- */
/* Get Teeth For A Treatment              */
/* -------------------------------------- */

export async function getTreatmentTeeth(
  treatmentPlanItemId: string
): Promise<number[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("treatment_teeth")
    .select("tooth_number")
    .eq("clinic_id", clinicId)
    .eq("treatment_plan_item_id", treatmentPlanItemId)
    .order("tooth_number");

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => row.tooth_number as number);
}

/* -------------------------------------- */
/* Get Treatments For A Tooth (reverse)   */
/* -------------------------------------- */

/**
 * All treatment_plan_items ever associated with one patient's tooth,
 * newest first. treatment_plan_items has no patient_id column of its
 * own (only its parent treatment_plans row does), so this scopes
 * ownership via the patient's own plan ids rather than relying on a
 * PostgREST embedded-relation filter - kept to the plain .eq()/.in()
 * filters already proven elsewhere in this codebase.
 *
 * Phase D (section 20): treatment_teeth is the primary/authoritative
 * source, but an item with NO treatment_teeth relationship at all (a
 * pre-Phase-A record, or one created through a path that predates the
 * Phase D unification) still needs to be found via its legacy
 * tooth_number column - this is the "historical fallback" the spec
 * requires. Once a real relationship exists for an item it always wins,
 * so an item can never be returned twice even if its (possibly stale)
 * legacy tooth_number happens to equal the tooth being looked up.
 */
export async function getTreatmentsForTooth(
  patientId: string,
  toothNumber: number
): Promise<TreatmentPlanItem[]> {
  const clinicId = await getCurrentClinicId();

  const { data: plans, error: plansError } = await supabase
    .from("treatment_plans")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId);

  if (plansError) {
    throw plansError;
  }

  const planIds = (plans ?? []).map((row) => row.id as string);

  if (planIds.length === 0) {
    return [];
  }

  const [relationsResult, itemsResult] = await Promise.all([
    supabase
      .from("treatment_teeth")
      .select("treatment_plan_item_id")
      .eq("clinic_id", clinicId)
      .eq("tooth_number", toothNumber),
    supabase
      .from("treatment_plan_items")
      .select("*, treatment_teeth(tooth_number)")
      .eq("clinic_id", clinicId)
      .in("treatment_plan_id", planIds),
  ]);

  if (relationsResult.error) {
    throw relationsResult.error;
  }

  if (itemsResult.error) {
    throw itemsResult.error;
  }

  const relatedItemIds = new Set(
    (relationsResult.data ?? []).map(
      (row) => row.treatment_plan_item_id as string
    )
  );

  type ItemWithTeeth = TreatmentPlanItem & {
    treatment_teeth?: { tooth_number: number }[];
  };

  const matches = ((itemsResult.data ?? []) as ItemWithTeeth[]).filter(
    (item) => {
      if (relatedItemIds.has(item.id)) {
        return true;
      }

      const hasRelationship = (item.treatment_teeth?.length ?? 0) > 0;

      return !hasRelationship && item.tooth_number === toothNumber;
    }
  );

  return matches.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ) as TreatmentPlanItem[];
}

/* -------------------------------------- */
/* Add Teeth To A Treatment               */
/* -------------------------------------- */

/**
 * Associates one or more teeth with a treatment item in a single insert
 * statement, so a multi-tooth call (e.g. 16, 17, 18) either fully
 * succeeds or fully fails together rather than partially applying -
 * true atomicity available for free from a single-statement write,
 * without introducing any new transaction mechanism. Safe to call again
 * with teeth that are already associated (ignoreDuplicates against the
 * table's own unique constraint), so this alone covers "add" and
 * "add without duplicating" - there is no separate singular variant.
 */
export async function addTreatmentTeeth(
  treatmentPlanItemId: string,
  toothNumbers: number[]
): Promise<void> {
  await assertPermission("treatments");

  const uniqueTeeth = [...new Set(toothNumbers)];

  assertValidToothNumbers(uniqueTeeth);

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("treatment_teeth")
    .upsert(
      uniqueTeeth.map((tooth_number) => ({
        clinic_id: clinicId,
        treatment_plan_item_id: treatmentPlanItemId,
        tooth_number,
      })),
      {
        onConflict: "treatment_plan_item_id,tooth_number",
        ignoreDuplicates: true,
      }
    );

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Remove One Tooth From A Treatment      */
/* -------------------------------------- */

export async function removeTreatmentTooth(
  treatmentPlanItemId: string,
  toothNumber: number
): Promise<void> {
  await assertPermission("treatments");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("treatment_teeth")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("treatment_plan_item_id", treatmentPlanItemId)
    .eq("tooth_number", toothNumber);

  if (error) {
    throw error;
  }
}

/* -------------------------------------- */
/* Replace A Treatment's Entire Tooth Set */
/* -------------------------------------- */

/**
 * Swaps a treatment's tooth set for a new one (e.g. 16,17,18 -> 16,17).
 * Not atomic across the delete+insert pair - this codebase has no
 * established Postgres RPC/transaction pattern for a multi-step write
 * like this (saveTooth() and billTreatmentPlanItems() are similarly
 * sequential, non-atomic multi-step writes), so introducing one here
 * would be new infrastructure, not a Phase A concern. If Phase B needs
 * true atomicity, this is the one call site that would move to an RPC.
 */
export async function replaceTreatmentTeeth(
  treatmentPlanItemId: string,
  toothNumbers: number[]
): Promise<void> {
  await assertPermission("treatments");

  const clinicId = await getCurrentClinicId();

  const { error: deleteError } = await supabase
    .from("treatment_teeth")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("treatment_plan_item_id", treatmentPlanItemId);

  if (deleteError) {
    throw deleteError;
  }

  if (toothNumbers.length === 0) {
    return;
  }

  await addTreatmentTeeth(treatmentPlanItemId, toothNumbers);
}
