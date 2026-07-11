import { supabase } from "@/lib/supabase";

import {
  PatientTooth,
  SavePatientTooth,
} from "@/types";

export async function getPatientTeeth(
  patientId: string
): Promise<PatientTooth[]> {
  const { data, error } = await supabase
    .from("patient_teeth")
    .select("*")
    .eq("patient_id", patientId);

  if (error) {
    throw error;
  }

  return (data ?? []) as PatientTooth[];
}

export async function saveTooth(
  tooth: SavePatientTooth
): Promise<void> {
  const { error } = await supabase
    .from("patient_teeth")
    .upsert(tooth, {
      onConflict: "patient_id,tooth_number",
    });

  if (error) {
    throw error;
  }

  return;
}

export async function getTooth(
  patientId: string,
  toothNumber: number
): Promise<PatientTooth | null> {
  const { data, error } = await supabase
    .from("patient_teeth")
    .select("*")
    .eq("patient_id", patientId)
    .eq("tooth_number", toothNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as PatientTooth | null;
}