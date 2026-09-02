import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types";

import { getCurrentClinicId } from "./clinic";
import { localDateString } from "@/lib/dateUtils";

export async function getCalendarAppointments(
  startDate: string,
  endDate: string
): Promise<Appointment[]> {
  const clinicId = await getCurrentClinicId();

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
    .gte("appointment_date", startDate)
    .lte("appointment_date", endDate)
    // Completed appointments stay in the database (patient history,
    // billing, analytics, etc. all still read them via getAppointments/
    // getAppointmentById) - they're just excluded from the calendar view
    // itself, which is what this function is dedicated to.
    .neq("status", "Completed")
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
  const clinicId = await getCurrentClinicId();

  const appointmentDate =
    localDateString(start);

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
    .eq("clinic_id", clinicId)
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
  const clinicId = await getCurrentClinicId();

  const appointmentDate =
    localDateString(start);

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
    .eq("clinic_id", clinicId)
    .eq("id", appointmentId);

  if (error) {
    throw error;
  }
}