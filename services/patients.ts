import { supabase } from "@/lib/supabase";
import { Patient } from "@/types/patient";

export async function getPatients(): Promise<Patient[]> {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return (data as Patient[]) ?? [];
}

export async function getPatientCount() {
  const { count, error } = await supabase
    .from("patients")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function createPatient(
  patient: Omit<Patient, "id" | "created_at">
) {
  const { error } = await supabase
    .from("patients")
    .insert(patient);

  if (error) {
    throw error;
  }
}

export async function getPatientById(id: string) {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data as Patient;
}

export async function updatePatient(
  id: string,
  patient: Partial<Patient>
) {
  const { error } = await supabase
    .from("patients")
    .update(patient)
    .eq("id", id);

  if (error) throw error;
}

export async function deletePatient(id: string) {
  const { error } = await supabase
    .from("patients")
    .delete()
    .eq("id", id);

  if (error) throw error;
}