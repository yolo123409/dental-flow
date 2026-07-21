import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "./clinic";

export interface DashboardStats {
  patients: number;
  appointments: number;
  dentists: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const clinicId = await getCurrentClinicId();

  const [
    patients,
    appointments,
    dentists,
  ] = await Promise.all([
    supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId),

    supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId),

    supabase
      .from("dentists")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId),
  ]);

  return {
    patients: patients.count ?? 0,
    appointments: appointments.count ?? 0,
    dentists: dentists.count ?? 0,
  };
}

export async function getRecentPatients(limit = 5) {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function getTodaysAppointments() {
  const clinicId = await getCurrentClinicId();

  const today = new Date()
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("appointments")
    .select(`
      *,
      patients (
        first_name,
        last_name
      ),
      dentists (
        full_name
      )
    `)
    .eq("clinic_id", clinicId)
    .eq("appointment_date", today)
    .order("appointment_time");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}