import { supabase } from "@/lib/supabase";

import { TimelineItem } from "@/types";

import { getCurrentClinicId } from "./clinic";

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
}

interface InvoiceRow {
  id: string;
  total: number;
  created_at: string;
}

export async function getPatientTimeline(
  patientId: string
): Promise<TimelineItem[]> {
  const clinicId = await getCurrentClinicId();

  const [
    appointments,
    charges,
    invoices,
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, treatment, appointment_date")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    supabase
      .from("clinic_charges")
      .select(
        "id, treatment_name, amount, created_at"
      )
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),

    supabase
      .from("clinic_invoices")
      .select("id, total, created_at")
      .eq("clinic_id", clinicId)
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

  (charges.data as ChargeRow[] | null)?.forEach(
    (charge) => {
      items.push({
        id: charge.id,
        patient_id: patientId,
        title: charge.treatment_name,
        description: `KSh ${charge.amount}`,
        created_at: charge.created_at,
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
        description: `KSh ${invoice.total}`,
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