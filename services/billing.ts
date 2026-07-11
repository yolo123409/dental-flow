import { supabase } from "@/lib/supabase";

export async function getPatientInvoices(patientId: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export function calculateBalance(invoices: any[]) {
  const total = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.amount ?? 0),
    0
  );

  const paid = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.paid ?? 0),
    0
  );

  return {
    total,
    paid,
    outstanding: total - paid,
  };
}

export async function recordInvoicePayment(
  invoiceId: string,
  paymentAmount: number
) {
  // Get the current invoice
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("amount, paid")
    .eq("id", invoiceId)
    .single();

  if (error) {
    throw error;
  }

  const totalAmount = Number(invoice.amount);
  const currentPaid = Number(invoice.paid ?? 0);

  const newPaid = Math.min(
    currentPaid + paymentAmount,
    totalAmount
  );

  const balance = totalAmount - newPaid;

  const status =
    balance === 0
      ? "Paid"
      : newPaid > 0
      ? "Partially Paid"
      : "Pending";

  const { data: updatedInvoice, error: updateError } =
    await supabase
      .from("invoices")
      .update({
        paid: newPaid,
        balance,
        status,
      })
      .eq("id", invoiceId)
      .select()
      .single();

  if (updateError) {
    throw updateError;
  }

  return updatedInvoice;
}