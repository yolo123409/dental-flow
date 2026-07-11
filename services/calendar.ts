import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types";

export async function getCalendarAppointments(
  startDate: string,
  endDate: string
): Promise<Appointment[]> {
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
    .gte("appointment_date", startDate)
    .lte("appointment_date", endDate)
    .order("appointment_date")
    .order("appointment_time");

  if (error) {
    console.error("Failed to load calendar:", error);
    return [];
  }

  return (data as Appointment[]) ?? [];
}