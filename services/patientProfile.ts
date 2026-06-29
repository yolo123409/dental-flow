import { supabase } from "@/lib/supabase";

export async function getPatientProfile(id: string) {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}

export async function getPatientAppointments(id: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select(`
      *,
      dentists(full_name)
    `)
    .eq("patient_id", id)
    .order("appointment_date", {
      ascending: false,
    });

  if (error) throw error;

  return data ?? [];
}