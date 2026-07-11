import { supabase } from "@/lib/supabase";

import { TimelineItem } from "@/types";

interface AppointmentRow {
  id: string;
  treatment: string;
  appointment_date: string;
}

interface TreatmentRow {
  id: string;
  treatment_name: string;
  diagnosis: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  amount: number;
  created_at: string;
}

export async function getPatientTimeline(
  patientId: string
): Promise<TimelineItem[]> {
  const [
    appointments,
    treatments,
    invoices,
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, treatment, appointment_date")
      .eq("patient_id", patientId),

    supabase
      .from("treatments")
      .select(
        "id, treatment_name, diagnosis, created_at"
      )
      .eq("patient_id", patientId),

    supabase
      .from("invoices")
      .select("id, amount, created_at")
      .eq("patient_id", patientId),
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

  (treatments.data as TreatmentRow[] | null)?.forEach(
    (treatment) => {
      items.push({
        id: treatment.id,
        patient_id: patientId,
        title: treatment.treatment_name,
        description:
          treatment.diagnosis ?? "",
        created_at: treatment.created_at,
        type: "treatment",
      });
    }
  );

  (invoices.data as InvoiceRow[] | null)?.forEach(
    (invoice) => {
      items.push({
        id: invoice.id,
        patient_id: patientId,
        title: "Invoice",
        description: `KSh ${invoice.amount}`,
        created_at: invoice.created_at,
        type: "invoice",
      });
    }
  );

  return items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );
}