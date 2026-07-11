import { supabase } from "@/lib/supabase";

interface TreatmentInput {
  patient_id: string;
  dentist_id: string;
  appointment_id?: string;

  treatment_name: string;
  tooth_number?: string;
  diagnosis?: string;
  procedure_notes?: string;
  prescription?: string;

  cost: number;

  duration?: number;
  follow_up_date?: string;
}

export async function createTreatment(
  treatment: TreatmentInput
) {
  const { data, error } = await supabase
    .from("treatments")
    .insert(treatment)
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from("invoices")
    .insert({
      patient_id: treatment.patient_id,
      appointment_id: treatment.appointment_id,
      amount: treatment.cost,
      paid: 0,
      balance: treatment.cost,
      status: "Pending",
    });

  return data;
}