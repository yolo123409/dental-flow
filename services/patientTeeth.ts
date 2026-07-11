import { supabase } from "@/lib/supabase";

export async function getPatientTeeth(
  patientId: string
) {
  const { data, error } = await supabase
    .from("patient_teeth")
    .select("*")
    .eq("patient_id", patientId);

  if (error) throw error;

  return data;
}

export async function saveTooth(
  tooth: any
) {
  const { error } = await supabase
    .from("patient_teeth")
    .upsert(tooth, {
      onConflict: "patient_id,tooth_number",
    });

  if (error) throw error;
}

export async function getTooth(
  patientId: string,
  tooth: number
) {
  const { data, error } = await supabase
    .from("patient_teeth")
    .select("*")
    .eq("patient_id", patientId)
    .eq("tooth_number", tooth)
    .maybeSingle();

  if (error) throw error;

  return data;
}