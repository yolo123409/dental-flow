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

export async function saveTooth(
  tooth: SavePatientTooth
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