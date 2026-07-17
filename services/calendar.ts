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
    console.error(
      "Failed to load calendar:",
      error
    );

    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function moveAppointment(
  appointmentId: string,
  start: Date,
  end: Date | null
): Promise<void> {
  const appointmentDate =
    start.toISOString().split("T")[0];

  const appointmentTime =
    start.toTimeString().slice(0, 5);

  const duration = end
    ? Math.round(
        (end.getTime() -
          start.getTime()) /
          60000
      )
    : null;

  const { error } = await supabase
    .from("appointments")
    .update({
      appointment_date:
        appointmentDate,

      appointment_time:
        appointmentTime,

      duration,
    })
    .eq("id", appointmentId);

  if (error) {
    throw error;
  }
}

export async function resizeAppointment(
  appointmentId: string,
  start: Date,
  end: Date
): Promise<void> {
  const appointmentDate =
    start.toISOString().split("T")[0];

  const appointmentTime =
    start.toTimeString().slice(0, 5);

  const duration = Math.round(
    (end.getTime() -
      start.getTime()) /
      60000
  );

  const { error } = await supabase
    .from("appointments")
    .update({
      appointment_date:
        appointmentDate,

      appointment_time:
        appointmentTime,

      duration,
    })
    .eq("id", appointmentId);

  if (error) {
    throw error;
  }
}