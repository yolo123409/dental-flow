import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { assertPermission } from "./authorization";
import { ClinicInvoice } from "./billing";

import { CustomerCredit, CustomerCreditWithInvoice } from "@/types/customerCredits";

/**
 * FIN-4.4: minimal Customer Credit foundation - grant/apply/refund, no
 * UI yet. Every write goes through one of the three SECURITY DEFINER
 * RPCs in migration 0100 (each does its own role check server-side, the
 * same "app check is a courtesy, the database is the real gate" pattern
 * FIN-3.8 established elsewhere) - assertPermission() here is only for
 * a fast, friendly client-side error before the round trip, exactly
 * mirroring how recordPayment() in services/billing.ts uses "billing".
 */

/**
 * Reclassifies an overpaid invoice's excess into a Customer Credit -
 * never touches the invoice's own amount_paid/balance/status (those stay
 * the accurate historical record of what was actually paid). Defaults to
 * crediting the FULL overpayment when amount is omitted.
 */
export async function grantCustomerCredit(
  invoiceId: string,
  amount?: number,
  notes?: string
): Promise<CustomerCredit> {
  await assertPermission("billing");

  const { data, error } = await supabase.rpc("grant_customer_credit", {
    p_invoice_id: invoiceId,
    p_amount: amount ?? null,
    p_notes: notes ?? null,
  });

  if (error) {
    logError("[customerCredits] grantCustomerCredit failed:", error);
    throw toError(error);
  }

  return data as CustomerCredit;
}

/**
 * Applies an existing credit against a different, currently-outstanding
 * invoice for the SAME patient - reduces that invoice's balance exactly
 * as a payment would, and returns the updated invoice.
 */
export async function applyCustomerCredit(
  creditId: string,
  invoiceId: string,
  amount: number
): Promise<ClinicInvoice> {
  await assertPermission("billing");

  if (!(amount > 0)) {
    throw new Error("Enter an amount greater than zero.");
  }

  const { data, error } = await supabase.rpc("apply_customer_credit", {
    p_credit_id: creditId,
    p_invoice_id: invoiceId,
    p_amount: amount,
  });

  if (error) {
    logError("[customerCredits] applyCustomerCredit failed:", error);
    throw toError(error);
  }

  return data as ClinicInvoice;
}

/**
 * Records a refund that already happened outside the system (cash
 * handed back, a real M-Pesa reversal already sent) - never moves money
 * itself, the same pattern services/billing.ts#recordPayment and
 * services/expenses.ts already use to record money that already moved.
 */
export async function refundCustomerCredit(
  creditId: string,
  amount: number,
  paymentMethod: string,
  reference?: string,
  notes?: string
): Promise<CustomerCredit> {
  await assertPermission("billing");

  if (!(amount > 0)) {
    throw new Error("Enter an amount greater than zero.");
  }

  const { data, error } = await supabase.rpc("refund_customer_credit", {
    p_credit_id: creditId,
    p_amount: amount,
    p_payment_method: paymentMethod,
    p_reference: reference ?? null,
    p_notes: notes ?? null,
  });

  if (error) {
    logError("[customerCredits] refundCustomerCredit failed:", error);
    throw toError(error);
  }

  return data as CustomerCredit;
}

/**
 * Full-app audit fix H8: undoes a mistakenly-applied credit (e.g. applied
 * to the wrong invoice from ApplyCustomerCreditModal's plain dropdown).
 * Restores the credit's remaining_amount and reverses the invoice's
 * amount_paid/balance/status by exactly this amount - the dedicated
 * replacement for the Ledger's generic "Reverse Transaction," which
 * cannot do either of those and was never safe to use for this (migration
 * 0115). Identified the same way it was applied - by credit + invoice +
 * amount - since a single credit's ledger postings aren't uniquely
 * addressable by reference_id the way an invoice/payment's are.
 */
export async function reverseCustomerCreditApplication(
  creditId: string,
  invoiceId: string,
  amount: number,
  reason?: string
): Promise<ClinicInvoice> {
  // "ledger" (Owner/Admin only), matching voidInvoice/voidPayment
  // (services/billing.ts) - the RPC itself requires the same, since
  // undoing money movement is a stricter action than the "billing"
  // permission that gates creating/applying it in the first place.
  await assertPermission("ledger");

  if (!(amount > 0)) {
    throw new Error("Enter an amount greater than zero.");
  }

  const { data, error } = await supabase.rpc("reverse_customer_credit_application", {
    p_credit_id: creditId,
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_reason: reason ?? null,
  });

  if (error) {
    logError("[customerCredits] reverseCustomerCreditApplication failed:", error);
    throw toError(error);
  }

  return data as ClinicInvoice;
}

/**
 * Every Customer Credit ever granted to a patient, newest first -
 * including fully-applied/refunded ones (remaining_amount = 0), so a
 * future UI can show history, not just what's currently available.
 */
export async function getPatientCredits(patientId: string): Promise<CustomerCreditWithInvoice[]> {
  await assertPermission("billing");

  const { data, error } = await supabase
    .from("clinic_customer_credits")
    .select("*, source_invoice:clinic_invoices(invoice_number)")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    logError("[customerCredits] getPatientCredits failed:", error);
    throw toError(error);
  }

  return (data ?? []) as CustomerCreditWithInvoice[];
}
