import { supabase } from "@/lib/supabase";

import { TimelineCodeBadge, TimelineItem } from "@/types";

import { getCurrentClinicId } from "./clinic";
import { getAllToothCodesForPatient } from "./clinicalCodes";

interface AppointmentRow {
  id: string;
  treatment: string;
  appointment_date: string;
}

interface ChargeRow {
  id: string;
  treatment_name: string;
  amount: number;
  created_at: string;
  tooth_number: number | null;
}

interface InvoiceRow {
  id: string;
  total: number;
  created_at: string;
}

interface ReminderRow {
  id: string;
  created_at: string;
  appointments: { treatment: string } | null;
  clinic_users: { full_name: string } | null;
}

export async function getPatientTimeline(
  patientId: string
): Promise<TimelineItem[]> {
  const clinicId = await getCurrentClinicId();

  const [
    appointments,
    charges,
    invoices,
    reminders,
    toothCodes,
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, treatment, appointment_date")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    supabase
      .from("clinic_charges")
      .select(
        "id, treatment_name, amount, created_at, tooth_number"
      )
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    supabase
      .from("clinic_invoices")
      .select("id, total, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    supabase
      .from("clinic_whatsapp_reminders")
      .select(
        "id, created_at, appointments(treatment), clinic_users(full_name)"
      )
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    // Read-only, gracefully empty if the coding tables aren't migrated
    // in yet (see services/clinicalCodes.ts) - a timeline with no coding
    // available must still render everything else normally.
    getAllToothCodesForPatient(patientId),
  ]);

  const items: TimelineItem[] = [];

  (appointments.data as AppointmentRow[] | null)?.forEach(
    (appointment) => {
      items.push({
        id: appointment.id,
        patient_id: patientId,
        title: appointment.treatment,
        description: "Appointment",
        created_at: appointment.appointment_date,
        type: "appointment",
      });
    }
  );

  (charges.data as ChargeRow[] | null)?.forEach(
    (charge) => {
      const toothNumber = charge.tooth_number;

      const diagnosisCodes: TimelineCodeBadge[] | undefined =
        toothNumber != null
          ? toothCodes.diagnosisByTooth
              .get(toothNumber)
              ?.map((row) => ({
                codeSystem: row.code_system,
                code: row.clinical_codes.code,
                shortDescription: row.clinical_codes.short_description,
              }))
          : undefined;

      const procedureCodes: TimelineCodeBadge[] | undefined =
        toothNumber != null
          ? toothCodes.procedureByTooth
              .get(toothNumber)
              ?.map((row) => ({
                codeSystem: row.code_system,
                code: row.clinical_codes.code,
                shortDescription: row.clinical_codes.short_description,
              }))
          : undefined;

      items.push({
        id: charge.id,
        patient_id: patientId,
        title: charge.treatment_name,
        description: `KSh ${charge.amount}`,
        created_at: charge.created_at,
        type: "treatment",
        diagnosisCodes: diagnosisCodes?.length ? diagnosisCodes : undefined,
        procedureCodes: procedureCodes?.length ? procedureCodes : undefined,
      });
    }
  );

  (invoices.data as InvoiceRow[] | null)?.forEach(
    (invoice) => {
      items.push({
        id: invoice.id,
        patient_id: patientId,
        title: "Invoice",
        description: `KSh ${invoice.total}`,
        created_at: invoice.created_at,
        type: "invoice",
      });
    }
  );

  (reminders.data as ReminderRow[] | null)?.forEach(
    (reminder) => {
      const treatment =
        reminder.appointments?.treatment ?? "Appointment";

      const initiator =
        reminder.clinic_users?.full_name;

      items.push({
        id: reminder.id,
        patient_id: patientId,
        title: "WhatsApp reminder opened",
        description: initiator
          ? `${treatment} · Opened by ${initiator}`
          : treatment,
        created_at: reminder.created_at,
        type: "reminder",
      });
    }
  );

  return items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );
}
