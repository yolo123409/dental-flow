import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types/appointment";

export async function getAppointments(): Promise<Appointment[]> {
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
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true });

  if (error) {
    console.error("Failed to fetch appointments:", error);
    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function getAppointmentById(
  id: string
): Promise<Appointment | null> {
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
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to fetch appointment:", error);
    return null;
  }

  return data as Appointment;
}

export async function getAppointmentCount(): Promise<number> {
  const { count, error } = await supabase
    .from("appointments")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error("Failed to count appointments:", error);
    return 0;
  }

  return count ?? 0;
}

export async function getTodaysAppointments(): Promise<Appointment[]> {
  const today = new Date().toISOString().split("T")[0];

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
    .eq("appointment_date", today)
    .order("appointment_time", { ascending: true });

  if (error) {
    console.error("Failed to fetch today's appointments:", error);
    return [];
  }

  return (data as Appointment[]) ?? [];
}

interface CreateAppointmentData {
  patient_id: string;
  dentist_id: string;
  appointment_date: string;
  appointment_time: string;
  treatment: string;
  notes?: string;
  status?: string;
}

export async function createAppointment(
  appointment: CreateAppointmentData
) {
  const payload = {
    patient_id: appointment.patient_id,
    dentist_id: appointment.dentist_id,
    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
    duration: 30,
    treatment: appointment.treatment,
    notes: appointment.notes ?? "",
    status: appointment.status ?? "Scheduled",
  };

  const { data, error } = await supabase
    .from("appointments")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("Supabase insert error:", error);
    throw error;
  }

  return data;
}

export async function updateAppointment(
  id: string,
  appointment: Partial<Appointment>
) {
  const { error } = await supabase
    .from("appointments")
    .update(appointment)
    .eq("id", id);

  if (error) {
    console.error("Failed to update appointment:", error);
    throw error;
  }
}

export async function deleteAppointment(id: string) {
  const { error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete appointment:", error);
    throw error;
  }
}