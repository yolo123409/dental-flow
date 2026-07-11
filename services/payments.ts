import { supabase } from "@/lib/supabase";

interface PaymentInput {
  invoice_id: string;
  patient_id: string;

  amount: number;

  payment_method: string;

  transaction_reference?: string;

  notes?: string;

  received_by?: string;
}

export async function createPayment(
  payment: PaymentInput
) {
  const { data, error } = await supabase
    .from("payments")
    .insert(payment)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}