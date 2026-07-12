import { supabase } from "@/lib/supabase";

import { Patient } from "@/types/patient";

import { getCurrentClinicId } from "./clinic";

export async function getPatients(): Promise<Patient[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patients")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    console.error(error);
    return [];
  }

  return (data ??
    []) as Patient[];
}

export async function getPatientOptions() {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patients")
      .select(
        "id, first_name, last_name"
      )
      .eq("clinic_id", clinicId)
      .order("first_name");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function getPatientCount() {
  const clinicId =
    await getCurrentClinicId();

  const { count, error } =
    await supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId);

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function createPatient(
  patient: Omit<
    Patient,
    | "id"
    | "created_at"
    | "clinic_id"
  >
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patients")
      .insert({
        ...patient,
        clinic_id: clinicId,
      });

  if (error) {
    throw error;
  }
}

export async function getPatientById(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("patients")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .single();

  if (error) {
    throw error;
  }

  return data as Patient;
}

export async function updatePatient(
  id: string,
  patient: Partial<Patient>
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patients")
      .update(patient)
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deletePatient(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("patients")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    throw error;
  }
}