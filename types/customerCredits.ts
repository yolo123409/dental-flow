/**
 * FIN-4.4: the patient-facing record of an overpayment reclassified as a
 * Customer Credit. The ledger transactions (CustomerCreditGrant/
 * Application/Refund) remain the audit trail - this is the
 * current-balance view, one row per grant. See
 * supabase/migrations/0100_customer_credits_foundation.sql for the full
 * design rationale.
 */
export interface CustomerCredit {
  id: string;
  clinic_id: string;
  patient_id: string;
  source_invoice_id: string;
  amount: number;
  remaining_amount: number;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

/** FIN-4.7: getPatientCredits() joins the source invoice's number so the
 * UI can show "Credit from INV-00007" without a second round trip. */
export interface CustomerCreditWithInvoice extends CustomerCredit {
  source_invoice: { invoice_number: string } | null;
}
