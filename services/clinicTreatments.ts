import { supabase } from "@/lib/supabase";

export interface ClinicTreatment {
  id: string;

  clinic_id: string;

  treatment_name: string;

  default_price: number;

  active: boolean;
}

export async function getClinicTreatments(
  clinicId: string
) {
  const { data, error } =
    await supabase
      .from("clinic_treatments")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("treatment_name");

  if (error) throw error;

  return data ?? [];
}

export async function getTreatmentPrice(
  clinicId: string,
  treatment: string
) {
  const { data, error } =
    await supabase
      .from("clinic_treatments")
      .select("default_price")
      .eq("clinic_id", clinicId)
      .ilike(
        "treatment_name",
        treatment.trim()
      )
      .maybeSingle();

  if (error) throw error;

  return data?.default_price ?? null;
}