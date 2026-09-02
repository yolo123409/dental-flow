import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";

export interface BillingReminderRecord {
  id: string;
  clinic_id: string;
  patient_id: string;
  invoice_id: string;
  initiated_by: string | null;
  channel: "whatsapp";
  created_at: string;
}

/**
 * Records that a staff member opened the WhatsApp click-to-chat link for
 * this invoice's outstanding balance - NOT that the message was sent or
 * delivered, which DentalFlow has no way of knowing from a client-side
 * wa.me link. Mirrors services/whatsappReminders.ts#recordReminderOpened
 * exactly (billing audit fix #2), just against clinic_billing_reminders
 * (migration 0111) instead of clinic_whatsapp_reminders.
 */
export async function recordReminderOpened(params: {
  patientId: string;
  invoiceId: string;
}): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();
    const actor = await getCurrentClinicUser();

    const { error } = await supabase.from("clinic_billing_reminders").insert({
      clinic_id: clinicId,
      patient_id: params.patientId,
      invoice_id: params.invoiceId,
      initiated_by: actor?.id ?? null,
      channel: "whatsapp",
    });

    if (error) {
      logError("[billingReminders] Failed to record reminder opened:", error);
      throw toError(error);
    }
  } catch (error) {
    logError("[billingReminders] recordReminderOpened failed:", error);
    throw toError(error);
  }
}
