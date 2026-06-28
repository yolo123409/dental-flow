import { supabase } from "@/lib/supabase";

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

  const { error } = await supabase
    .from("appointments")
    .insert({
      patient_name: patientName,
      patient_email: patientEmail,
      patient_phone: patientPhone,
      treatment,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
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