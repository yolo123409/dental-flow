import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types/appointment";

export async function getAppointments(): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .order("appointment_date", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function getAppointmentCount(): Promise<number> {
  const { count, error } = await supabase
    .from("appointments")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function getTodaysAppointments(): Promise<Appointment[]> {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("appointment_date", today)
    .order("appointment_time", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function createAppointment(
  appointment: Omit<Appointment, "id" | "created_at">
) {
  const { error } = await supabase
    .from("appointments")
    .insert(appointment);

  if (error) {
    throw error;
  }
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
    throw error;
  }
}

export async function deleteAppointment(id: string) {
  const { error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }
}