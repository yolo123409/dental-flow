import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "./clinic";

export async function getPatientProfile(id: string) {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}

export async function getPatientAppointments(id: string) {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("appointments")
    .select(`
      *,
      dentists(full_name)
    `)
    .eq("clinic_id", clinicId)
    .eq("patient_id", id)
    .order("appointment_date", {
      ascending: false,
    });

  if (error) throw error;

  return data ?? [];
}