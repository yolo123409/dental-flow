import { supabase } from "@/lib/supabase";

export async function getAppointmentCount() {
  const { count } = await supabase
    .from("appointments")
    .select("*", {
      count: "exact",
      head: true,
    });

  return count ?? 0;
}

export async function getTodaysAppointments() {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("appointment_date", today)
    .order("appointment_time");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}