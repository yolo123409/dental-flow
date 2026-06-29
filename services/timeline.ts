import { supabase } from "@/lib/supabase";

export async function getPatientTimeline(patientId: string) {
  const [appointments, treatments, invoices] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("patient_id", patientId),

      supabase
        .from("treatments")
        .select("*")
        .eq("patient_id", patientId),

      supabase
        .from("invoices")
        .select("*")
        .eq("patient_id", patientId),
    ]);

  const items: any[] = [];

  appointments.data?.forEach((a: any) => {
    items.push({
      id: a.id,
      title: a.treatment,
      description: "Appointment",
      date: a.appointment_date,
      type: "appointment",
    });
  });

  treatments.data?.forEach((t: any) => {
    items.push({
      id: t.id,
      title: t.treatment_name,
      description: t.diagnosis,
      date: t.created_at,
      type: "treatment",
    });
  });

  invoices.data?.forEach((i: any) => {
    items.push({
      id: i.id,
      title: "Invoice",
      description: `KSh ${i.amount}`,
      date: i.created_at,
      type: "invoice",
    });
  });

  return items.sort(
    (a, b) =>
      new Date(b.date).getTime() -
      new Date(a.date).getTime()
  );
}