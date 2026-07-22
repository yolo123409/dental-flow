import { supabase } from "@/lib/supabase";

const MINIMUM_APPOINTMENT_DURATION_MINUTES = 60;

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export async function createAppointment(
  patientName: string,
  patientEmail: string,
  patientPhone: string,
  treatment: string,
  appointmentDate: string,
  appointmentTime: string
) {
  const { data: dentist } = await supabase
    .from("dentists")
    .select("id")
    .eq("active", true)
    .limit(1)
    .single();

  if (!dentist) {
    return {
      success: false,
      message: "No dentist is currently available.",
    };
  }

  const { data: existingAppointments, error: conflictError } = await supabase
    .from("appointments")
    .select("appointment_time, duration")
    .eq("dentist_id", dentist.id)
    .eq("appointment_date", appointmentDate)
    .neq("status", "Cancelled");

  if (conflictError) {
    return {
      success: false,
      message: "Unable to verify the dentist's availability.",
    };
  }

  const start = timeToMinutes(appointmentTime);
  const end = start + MINIMUM_APPOINTMENT_DURATION_MINUTES;
  const hasConflict = (existingAppointments ?? []).some((appointment) => {
    const existingStart = timeToMinutes(appointment.appointment_time);
    const existingEnd =
      existingStart +
      Math.max(
        appointment.duration ?? MINIMUM_APPOINTMENT_DURATION_MINUTES,
        MINIMUM_APPOINTMENT_DURATION_MINUTES
      );

    return start < existingEnd && existingStart < end;
  });

  if (hasConflict) {
    return {
      success: false,
      message: "This dentist already has an appointment within one hour of that time.",
    };
  }

  const { error } = await supabase
    .from("appointments")
    .insert({
      patient_name: patientName,
      patient_email: patientEmail,
      patient_phone: patientPhone,
      treatment,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      duration: MINIMUM_APPOINTMENT_DURATION_MINUTES,
      dentist_id: dentist.id,
      status: "Booked",
    });

  if (error) {
    return {
      success: false,
      message: error.message,
    };
  }

  return {
    success: true,
    message: "Appointment booked successfully.",
  };
}
