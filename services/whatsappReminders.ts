import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";

export interface WhatsAppReminderRecord {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string;
  initiated_by: string | null;
  channel: "whatsapp";
  created_at: string;
}

/**
 * Most recent reminder opened for a given appointment, if any - used to
 * show the "reminder recently opened" soft warning. Never blocks sending,
 * only informs.
 */
export async function getRecentReminderForAppointment(
  appointmentId: string
): Promise<WhatsAppReminderRecord | null> {
  try {
    const clinicId = await getCurrentClinicId();

    const { data, error } = await supabase
      .from("clinic_whatsapp_reminders")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logError("[whatsappReminders] Failed to load recent reminder:", error);
      throw toError(error);
    }

    return data as WhatsAppReminderRecord | null;
  } catch (error) {
    logError("[whatsappReminders] getRecentReminderForAppointment failed:", error);
    throw toError(error);
  }
}

/**
 * Records that a receptionist opened the WhatsApp click-to-chat link for
 * this appointment - NOT that the message was sent or delivered, which
 * DentalFlow has no way of knowing from a client-side wa.me link.
 */
export async function recordReminderOpened(params: {
  patientId: string;
  appointmentId: string;
}): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();
    const actor = await getCurrentClinicUser();

    const { error } = await supabase.from("clinic_whatsapp_reminders").insert({
      clinic_id: clinicId,
      patient_id: params.patientId,
      appointment_id: params.appointmentId,
      initiated_by: actor?.id ?? null,
      channel: "whatsapp",
    });

    if (error) {
      logError("[whatsappReminders] Failed to record reminder opened:", error);
      throw toError(error);
    }
  } catch (error) {
    logError("[whatsappReminders] recordReminderOpened failed:", error);
    throw toError(error);
  }
}
