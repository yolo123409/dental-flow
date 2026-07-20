import { supabase } from "@/lib/supabase";
import { Dentist } from "@/types/dentist";

import { getCurrentClinicId } from "./clinic";

export async function getDentists(): Promise<Dentist[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to fetch dentists:", error);
    return [];
  }

  return (data as Dentist[]) ?? [];
}

export async function getDentistCount(): Promise<number> {
  const clinicId = await getCurrentClinicId();

  const { count, error } = await supabase
    .from("dentists")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId);

  if (error) {
    console.error("Failed to count dentists:", error);
    return 0;
  }

  return count ?? 0;
}

export async function getDentistOptions() {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to fetch dentist options:", error);
    return [];
  }

  return data ?? [];
}

export async function getDentistById(
  id: string
): Promise<Dentist | null> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to fetch dentist:", error);
    return null;
  }

  return data as Dentist;
}

export async function createDentist(
  dentist: Omit<
    Dentist,
    | "id"
    | "created_at"
    | "appointments_today"
    | "patients_seen"
    | "revenue"
  >
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .insert({ ...dentist, clinic_id: clinicId });

  if (error) {
    throw error;
  }
}

export async function updateDentist(
  id: string,
  dentist: Partial<Dentist>
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .update(dentist)
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deleteDentist(id: string) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function toggleDentistStatus(
  id: string,
  active: boolean
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .update({ active })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}