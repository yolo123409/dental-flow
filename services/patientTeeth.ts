import { supabase } from "@/lib/supabase";

import {
  PatientTooth,
  SavePatientTooth,
} from "@/types";

import { getCurrentClinicId } from "./clinic";

/* -------------------------------------- */
/* Patient Teeth                          */
/* -------------------------------------- */

export async function getPatientTeeth(
  patientId: string
): Promise<PatientTooth[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_teeth")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("tooth_number");

  if (error) {
    throw error;
  }

  return (data ?? []) as PatientTooth[];
}

export async function getTooth(
  patientId: string,
  toothNumber: number
): Promise<PatientTooth | null> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_teeth")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("tooth_number", toothNumber)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data as PatientTooth | null;
}

/**
 * Phase H: `skipLegacyCharge` lets a caller save patient_teeth's
 * clinical fields (condition/diagnosis/treatment_status/materials/notes)
 * - and, unchanged, whatever historical treatment/estimated_cost value
 * this tooth already has - WITHOUT re-running the legacy Pending-charge
 * side effect below. Defaults to false, so every existing/other caller
 * keeps today's exact behavior unchanged. ToothDetails/TreatmentForm
 * (Phase H) always passes true: NEW billable Treatments are now created
 * exclusively through the canonical createTreatment() path (see "+ Add
 * Treatment"), so a clinical-only save here must never independently
 * stage a second, legacy charge for a tooth that already has one from
 * before this phase, and must never start a brand new legacy charge
 * going forward. This does NOT delete or alter tooth.treatment/
 * estimated_cost themselves - the historical text/number is preserved as
 * clinical history exactly as it always was; only the billing side
 * effect is skipped.
 */
export async function saveTooth(
  tooth: SavePatientTooth,
  options: { skipLegacyCharge?: boolean } = {}
): Promise<void> {
  const clinicId =
    await getCurrentClinicId();

  /* ------------------------------------ */
  /* Update Current Tooth                 */
  /* ------------------------------------ */

  const { error: saveError } =
    await supabase
      .from("patient_teeth")
      .upsert(
        {
          clinic_id: clinicId,

          patient_id:
            tooth.patient_id,

          tooth_number:
            tooth.tooth_number,

          condition:
            tooth.condition,

          diagnosis:
            tooth.diagnosis,

          treatment:
            tooth.treatment,

          treatment_status:
            tooth.treatment_status,

          materials:
            tooth.materials,

          estimated_cost:
            tooth.estimated_cost,

          notes:
            tooth.notes,
        },
        {
          onConflict:
            "clinic_id,patient_id,tooth_number",
        }
      );

  if (saveError) {
    throw saveError;
  }

  /* ------------------------------------ */
  /* Save History                         */
  /* ------------------------------------ */

  const { error: historyError } =
    await supabase
      .from("patient_tooth_history")
      .insert({
        clinic_id: clinicId,

        patient_id:
          tooth.patient_id,

        tooth_number:
          tooth.tooth_number,

        condition:
          tooth.condition,

        diagnosis:
          tooth.diagnosis,

        treatment:
          tooth.treatment,

        treatment_status:
          tooth.treatment_status,

        materials:
          tooth.materials,

        estimated_cost:
          tooth.estimated_cost,

        notes:
          tooth.notes,
      });

  if (historyError) {
    throw historyError;
  }

  /* ------------------------------------ */
  /* Create / Update Billing Charge       */
  /* ------------------------------------ */

  const treatment =
    tooth.treatment?.trim() ?? "";

  if (
    !options.skipLegacyCharge &&
    treatment !== "" &&
    tooth.estimated_cost != null &&
    tooth.estimated_cost > 0
  ) {
    const {
      data: existingCharge,
      error: findError,
    } = await supabase
      .from("clinic_charges")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", tooth.patient_id)
      .eq(
        "tooth_number",
        tooth.tooth_number
      )
      .eq(
        "treatment_name",
        treatment
      )
      .eq("status", "Pending")
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (existingCharge) {
      const {
        error: updateError,
      } = await supabase
        .from("clinic_charges")
        .update({
          amount:
            tooth.estimated_cost,
        })
        .eq(
          "id",
          existingCharge.id
        );

      if (updateError) {
        throw updateError;
      }
    } else {
      const {
        error: insertError,
      } = await supabase
        .from("clinic_charges")
        .insert({
          clinic_id: clinicId,

          patient_id:
            tooth.patient_id,

          tooth_number:
            tooth.tooth_number,

          treatment_name:
            treatment,

          amount:
            tooth.estimated_cost,

          status:
            "Pending",
        });

      if (insertError) {
        throw insertError;
      }
    }
  }
}

/* -------------------------------------- */
/* Tooth History                          */
/* -------------------------------------- */

export async function getToothHistory(
  patientId: string,
  toothNumber: number
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patient_tooth_history")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("tooth_number", toothNumber)
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    throw error;
  }

  return data ?? [];
}