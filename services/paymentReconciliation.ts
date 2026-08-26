import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

export interface PaymentLedgerReconciliation {
  totalPayments: number;
  postedPayments: number;
  missingPayments: number;
  mismatchedPayments: number;
  duplicatePayments: number;
  totalPaymentAmount: number;
  postedPaymentAmount: number;
  missingPaymentAmount: number;
  matches: boolean;
}

interface RawPaymentLedgerReconciliationRow {
  total_payments: number;
  posted_payments: number;
  missing_payments: number;
  mismatched_payments: number;
  duplicate_payments: number;
  total_payment_amount: number;
  posted_payment_amount: number;
  missing_payment_amount: number;
}

/**
 * Phase O2: standalone payment-ledger reconciliation check - detect
 * only, never corrects. Compares clinic_payments against their
 * Payment-type clinic_ledger_transactions/clinic_ledger_entries
 * postings via get_payment_ledger_reconciliation (migration 0083, the
 * same aggregate-RPC pattern as get_trial_balance/
 * get_outstanding_invoice_balance) rather than fetching every payment
 * row into JS.
 *
 * This is a DIFFERENT check from getArReconciliationStatus() (which
 * compares the Ledger AR account's balance against Outstanding Invoice
 * AR): a payment can be entirely missing its ledger posting while
 * having zero effect on the invoice/ledger figures those functions
 * compare, whenever the same invoice's own Invoice-type debit is also
 * missing (both sides missing, net AR effect = 0) - Phase O's own live
 * audit found exactly that for most of this clinic's 25 currently-
 * missing payment postings. Missing payment postings still affect Cash
 * Flow (services/ledger.ts#getCashFlowStatement derives collections
 * from the ledger, not from clinic_payments directly), which is why
 * this exists as its own diagnostic rather than being folded into the
 * AR check.
 *
 * `matches` is true only when every payment has exactly one correctly-
 * amounted posting (no missing, mismatched, or duplicate postings).
 * Never writes a correction, a journal entry, or a
 * reconciliation-issue row itself - a caller surfaces `matches: false`
 * for someone to investigate, exactly like getArReconciliationStatus().
 */
export async function getPaymentLedgerReconciliation(): Promise<PaymentLedgerReconciliation> {
  await assertPermission("ledger");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase.rpc("get_payment_ledger_reconciliation", {
    p_clinic_id: clinicId,
  });

  if (error) {
    logError("[paymentReconciliation] getPaymentLedgerReconciliation failed:", error);
    throw toError(error);
  }

  const row = (data?.[0] ?? {
    total_payments: 0,
    posted_payments: 0,
    missing_payments: 0,
    mismatched_payments: 0,
    duplicate_payments: 0,
    total_payment_amount: 0,
    posted_payment_amount: 0,
    missing_payment_amount: 0,
  }) as RawPaymentLedgerReconciliationRow;

  const missingPayments = Number(row.missing_payments);
  const mismatchedPayments = Number(row.mismatched_payments);
  const duplicatePayments = Number(row.duplicate_payments);

  return {
    totalPayments: Number(row.total_payments),
    postedPayments: Number(row.posted_payments),
    missingPayments,
    mismatchedPayments,
    duplicatePayments,
    totalPaymentAmount: Number(row.total_payment_amount),
    postedPaymentAmount: Number(row.posted_payment_amount),
    missingPaymentAmount: Number(row.missing_payment_amount),
    matches: missingPayments === 0 && mismatchedPayments === 0 && duplicatePayments === 0,
  };
}
