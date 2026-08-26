import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";
import { getArReconciliationStatus } from "./accountsReceivable";
import { getPaymentLedgerReconciliation } from "./paymentReconciliation";
import { getLedgerSettings } from "./ledger";

import {
  AccountingHealthChecks,
  AccountingHealthReport,
  ArReconciliationCheck,
  CashFlowReconciliationCheck,
  HealthStatus,
  HistoricalExceptionEntry,
  HistoricalExceptionsCheck,
  InvoiceConsistencyCheck,
  InvoiceConsistencyIssue,
  KnownPaymentException,
  LedgerIntegrityCheck,
  OverpaymentRow,
  OverpaymentsCheck,
  PaymentExceptionRow,
  PaymentReconciliationCheck,
} from "@/types/accountingHealth";

/**
 * Phase Q4: the canonical, typed definition of every currently-known
 * historical payment-ledger exception - the 4 invoices Phase P's own
 * final report named as deliberately, explicitly left unposted (a
 * user-approved scope decision, not an oversight): INV-00007/INV-00010
 * (overpaid - fully posting them would legitimately shift Ledger AR by
 * their real overpayment) and INV-00012/INV-00018 (blocked outright by
 * idx_clinic_ledger_transactions_reference_unique, migration 0044 - Phase
 * N already posted their one allowed Invoice-type transaction).
 *
 * This lives here, in the service layer, deliberately NOT in a UI
 * component (Q4's explicit instruction) - a page only ever renders the
 * computed HistoricalExceptionsCheck/PaymentReconciliationCheck this
 * service returns, never this list directly. `amount` is each invoice's
 * TOTAL missing-payment amount (summed across every one of its unposted
 * payments), matched against live data by summing all of that invoice's
 * live exception rows - never against a single payment row, since
 * INV-00007 and INV-00010 each have two separate missing payments.
 */
export const KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS: readonly KnownPaymentException[] = [
  {
    invoiceNumber: "INV-00007",
    amount: 58000,
    reason:
      "Historical payment ledger posting absent. This invoice is overpaid - posting its full payment history would legitimately shift Ledger AR by the overpayment amount, so Phase P deliberately left it unposted pending a dedicated future decision.",
  },
  {
    invoiceNumber: "INV-00010",
    amount: 11000,
    reason:
      "Historical payment ledger posting absent. This invoice is overpaid - posting its full payment history would legitimately shift Ledger AR by the overpayment amount, so Phase P deliberately left it unposted pending a dedicated future decision.",
  },
  {
    invoiceNumber: "INV-00012",
    amount: 40,
    reason:
      "Historical payment posting absent. This invoice already has one Invoice-type ledger transaction from Phase N - the database's own reference-uniqueness constraint (migration 0044) permanently blocks a second posting for it, so this gap cannot be safely closed by any future backfill.",
  },
  {
    invoiceNumber: "INV-00018",
    amount: 10000,
    reason:
      "Historical payment posting absent. This invoice already has one Invoice-type ledger transaction from Phase N - the database's own reference-uniqueness constraint (migration 0044) permanently blocks a second posting for it, so this gap cannot be safely closed by any future backfill.",
  },
] as const;

const EXCEPTION_AMOUNT_TOLERANCE = 0.01;

interface RawInvoiceConsistencyRow {
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  patient_name: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  issue: string;
}

interface RawPaymentExceptionRow {
  payment_id: string;
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  payment_amount: number;
  posting_count: number;
  posted_credit: number;
  exception_type: "missing" | "mismatched" | "duplicate";
}

interface RawLedgerIntegrityRow {
  total_transactions: number;
  transactions_without_entries: number;
  unbalanced_transactions: number;
  unbalanced_amount: number;
  duplicate_reference_groups: number;
  duplicate_reference_transactions: number;
}

function toPaymentExceptionRow(row: RawPaymentExceptionRow): PaymentExceptionRow {
  return {
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    amount: Number(row.payment_amount),
    exceptionType: row.exception_type,
  };
}

/* -------------------------------------- */
/* AR reconciliation (Q2)                 */
/* -------------------------------------- */

/**
 * Unlike the other checks, an AR mismatch has no "known historical"
 * variant to compare against - every prior phase's own safety guard
 * (Phase P's AR-before-must-equal-AR-after check, among others) treats
 * any Ledger AR / Outstanding Invoice AR divergence as something that
 * must never happen. So severity here is purely magnitude-based: a
 * larger, more material gap is more likely to represent a real posting
 * failure than sub-percent floating/timing noise. The threshold (greater
 * of KES 1,000 or 1% of the ledger balance) is a documented heuristic,
 * not a regulatory figure - it exists only to separate "investigate
 * immediately" from "keep an eye on this."
 */
function buildArCheck(ar: {
  ledgerBalance: number;
  invoiceOutstandingBalance: number;
  difference: number;
  matches: boolean;
}): ArReconciliationCheck {
  let status: HealthStatus = "healthy";

  if (!ar.matches) {
    const materialityThreshold = Math.max(1000, ar.ledgerBalance * 0.01);
    status = Math.abs(ar.difference) > materialityThreshold ? "critical" : "warning";
  }

  return {
    status,
    summary: ar.matches
      ? "Ledger AR and Outstanding Invoice AR agree exactly."
      : `Ledger AR and Outstanding Invoice AR differ by ${ar.difference.toFixed(2)}.`,
    explanation: ar.matches
      ? "The Accounts Receivable ledger account balance matches the sum of every currently-outstanding invoice's balance - the two independent sources of truth for what the clinic is owed agree."
      : "This is not a known historical exception - every accounting phase to date has treated any AR divergence as something that must never happen. Investigate before trusting AR-derived figures elsewhere in the app; do not attempt an automatic correction.",
    ledgerBalance: ar.ledgerBalance,
    invoiceOutstandingBalance: ar.invoiceOutstandingBalance,
    difference: ar.difference,
    matches: ar.matches,
  };
}

/* -------------------------------------- */
/* Payment reconciliation (Q3/Q5)         */
/* -------------------------------------- */

/**
 * For each invoice with at least one live payment exception, this is
 * "known" only when EVERY one of that invoice's exceptions is a
 * `missing` posting (never mismatched/duplicate - no known exception is
 * of that kind) AND the invoice's live unposted total matches the known
 * definition within a cent. Any invoice not meeting all three conditions
 * - a different invoice, a drifted amount, or a different exception kind
 * - is classified entirely as new, never partially.
 */
function classifyPaymentExceptions(
  rows: PaymentExceptionRow[]
): { known: PaymentExceptionRow[]; new: PaymentExceptionRow[] } {
  const byInvoice = new Map<string, PaymentExceptionRow[]>();

  for (const row of rows) {
    const list = byInvoice.get(row.invoiceNumber) ?? [];
    list.push(row);
    byInvoice.set(row.invoiceNumber, list);
  }

  const known: PaymentExceptionRow[] = [];
  const newOnes: PaymentExceptionRow[] = [];

  for (const [invoiceNumber, invoiceRows] of byInvoice) {
    const knownDefinition = KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS.find(
      (k) => k.invoiceNumber === invoiceNumber
    );

    const allMissing = invoiceRows.every((r) => r.exceptionType === "missing");
    const liveTotal = invoiceRows.reduce((sum, r) => sum + r.amount, 0);

    const isKnown =
      !!knownDefinition &&
      allMissing &&
      Math.abs(liveTotal - knownDefinition.amount) <= EXCEPTION_AMOUNT_TOLERANCE;

    (isKnown ? known : newOnes).push(...invoiceRows);
  }

  return { known, new: newOnes };
}

function buildPaymentReconciliationCheck(
  reconciliation: {
    totalPayments: number;
    postedPayments: number;
    missingPayments: number;
    mismatchedPayments: number;
    duplicatePayments: number;
    totalPaymentAmount: number;
    missingPaymentAmount: number;
    matches: boolean;
  },
  exceptionRows: PaymentExceptionRow[]
): PaymentReconciliationCheck {
  const { known, new: newExceptions } = classifyPaymentExceptions(exceptionRows);

  let status: HealthStatus = "healthy";
  if (newExceptions.length > 0) status = "critical";
  else if (known.length > 0) status = "warning";

  const newAmount = newExceptions.reduce((sum, r) => sum + r.amount, 0);
  const knownAmount = known.reduce((sum, r) => sum + r.amount, 0);

  let summary: string;
  let explanation: string;

  if (status === "healthy") {
    summary = "Every payment has exactly one correctly-amounted ledger posting.";
    explanation = "No missing, mismatched, or duplicate Payment-type ledger postings were found.";
  } else if (status === "warning") {
    summary = `${known.length} payment ledger exception${known.length === 1 ? "" : "s"} detected (KES ${knownAmount.toFixed(2)}) - all known historical exceptions.`;
    explanation =
      "These correspond to invoices from the pre-ledger-posting period that a prior phase explicitly reviewed and deliberately left unposted (see Known Historical Exceptions below). They are not new, have not been automatically altered, and require no action.";
  } else {
    summary = `${newExceptions.length} new payment ledger discrepanc${newExceptions.length === 1 ? "y" : "ies"} detected (KES ${newAmount.toFixed(2)}).`;
    explanation =
      known.length > 0
        ? `${known.length} additional known historical exception(s) (KES ${knownAmount.toFixed(2)}) are also present but are not the concern here. The new discrepancy has no corresponding known-exception entry - it needs investigation. Do not backfill it automatically.`
        : "This payment (or these payments) have no corresponding known-exception entry - they were created after the ledger posting system became active and should have posted automatically. Investigate the posting trigger; do not backfill it automatically.";
  }

  return {
    status,
    summary,
    explanation,
    totalPayments: reconciliation.totalPayments,
    postedPayments: reconciliation.postedPayments,
    missingPayments: reconciliation.missingPayments,
    mismatchedPayments: reconciliation.mismatchedPayments,
    duplicatePayments: reconciliation.duplicatePayments,
    totalPaymentAmount: reconciliation.totalPaymentAmount,
    missingPaymentAmount: reconciliation.missingPaymentAmount,
    matches: reconciliation.matches,
    knownExceptions: known,
    newExceptions,
  };
}

/* -------------------------------------- */
/* Historical exceptions (Q4)             */
/* -------------------------------------- */

function buildHistoricalExceptionsCheck(exceptionRows: PaymentExceptionRow[]): HistoricalExceptionsCheck {
  const byInvoice = new Map<string, PaymentExceptionRow[]>();

  for (const row of exceptionRows) {
    const list = byInvoice.get(row.invoiceNumber) ?? [];
    list.push(row);
    byInvoice.set(row.invoiceNumber, list);
  }

  const entries: HistoricalExceptionEntry[] = KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS.map((known) => {
    const liveRows = byInvoice.get(known.invoiceNumber) ?? [];
    const allMissing = liveRows.length > 0 && liveRows.every((r) => r.exceptionType === "missing");
    const liveAmount = liveRows.reduce((sum, r) => sum + r.amount, 0);
    const currentlyPresent = allMissing && Math.abs(liveAmount - known.amount) <= EXCEPTION_AMOUNT_TOLERANCE;

    return {
      invoiceNumber: known.invoiceNumber,
      knownAmount: known.amount,
      reason: known.reason,
      currentlyPresent,
      currentAmount: liveRows.length > 0 ? liveAmount : null,
    };
  });

  const presentCount = entries.filter((e) => e.currentlyPresent).length;

  return {
    status: presentCount > 0 ? "warning" : "healthy",
    summary:
      presentCount > 0
        ? `${presentCount} of ${entries.length} known historical exceptions are still unposted.`
        : "Every known historical exception has been resolved - none remain unposted.",
    explanation:
      presentCount > 0
        ? "These are the invoices Phase P's historical payment-ledger backfill explicitly reviewed and deliberately left untouched, for documented accounting reasons (see each entry below). They are not evidence of a bug and must not be automatically backfilled."
        : "No further action is needed for the historical exceptions this system has tracked to date.",
    entries,
  };
}

/* -------------------------------------- */
/* Invoice consistency (Q6)               */
/* -------------------------------------- */

function isOverpaymentRow(row: RawInvoiceConsistencyRow): boolean {
  return Number(row.balance) < -0.01 || Number(row.amount_paid) > Number(row.total) + 0.01;
}

function buildInvoiceConsistencyCheck(rows: RawInvoiceConsistencyRow[]): InvoiceConsistencyCheck {
  // Overpayment cases are surfaced in their own dedicated check (Q7) -
  // excluded here so the same invoice isn't reported as a "consistency
  // issue" and an "overpayment" simultaneously.
  const consistencyRows = rows.filter((row) => !isOverpaymentRow(row));

  const issues: InvoiceConsistencyIssue[] = consistencyRows.map((row) => ({
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    patientName: row.patient_name,
    issue: row.issue,
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    balance: Number(row.balance),
    status: row.status,
  }));

  // A wrong stored balance (the one arithmetic invariant this schema
  // must always uphold: balance = total - amount_paid) has real monetary
  // consequences and no known-historical precedent - critical. Every
  // other case here (a status/balance text mismatch like "Unpaid" with a
  // zero balance) has zero monetary impact - warning, per the explicit
  // INV-00030/INV-00033 precedent.
  const hasMonetaryImpact = issues.some((i) => i.issue === "balance does not equal total minus amount_paid");

  const status: HealthStatus = issues.length === 0 ? "healthy" : hasMonetaryImpact ? "critical" : "warning";

  return {
    status,
    summary:
      issues.length === 0
        ? "No invoice status/balance inconsistencies found."
        : `${issues.length} invoice${issues.length === 1 ? "" : "s"} with a status/balance inconsistency.`,
    explanation:
      issues.length === 0
        ? "Every invoice's stored total, amount paid, balance, and status agree with each other."
        : hasMonetaryImpact
          ? "At least one invoice's stored balance does not equal total minus amount paid - a real data-integrity bug with monetary consequences. This is new, not a known historical exception, and needs investigation; do not edit the invoice directly."
          : "These invoices have a stale or inconsistent status label but a genuinely zero balance - a known data-quality gap (createInvoice always sets status \"Unpaid\" regardless of the invoice total, so a zero-total invoice keeps that label forever) with zero monetary impact. No correction is applied automatically.",
    issues,
  };
}

/* -------------------------------------- */
/* Overpayments (Q7)                      */
/* -------------------------------------- */

function buildOverpaymentsCheck(rows: RawInvoiceConsistencyRow[]): OverpaymentsCheck {
  const knownInvoiceNumbers = new Set(KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS.map((k) => k.invoiceNumber));

  const overpayments: OverpaymentRow[] = rows
    .filter(isOverpaymentRow)
    .map((row) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      patientName: row.patient_name,
      total: Number(row.total),
      amountPaid: Number(row.amount_paid),
      balance: Number(row.balance),
      amountOverpaid: Number(row.amount_paid) - Number(row.total),
      isKnownException: knownInvoiceNumbers.has(row.invoice_number),
    }));

  const totalOverpaid = overpayments.reduce((sum, o) => sum + o.amountOverpaid, 0);

  return {
    status: overpayments.length === 0 ? "healthy" : "warning",
    summary:
      overpayments.length === 0
        ? "No overpaid invoices found."
        : `${overpayments.length} overpaid invoice${overpayments.length === 1 ? "" : "s"} (KES ${totalOverpaid.toFixed(2)} combined).`,
    explanation:
      overpayments.length === 0
        ? "No invoice currently has a negative balance or amount paid exceeding its total."
        : "DentalFlow has no formal credit-balance/refund architecture, so an overpayment is simply an invoice whose balance is negative - it is not money owed back or available to apply elsewhere. Nothing is refunded, credited, or corrected automatically.",
    overpayments,
    totalOverpaid,
  };
}

/* -------------------------------------- */
/* Cash Flow reconciliation (Q8)          */
/* -------------------------------------- */

/**
 * Deliberately does not call getCashFlowStatement() (Q8: "do NOT
 * duplicate the entire Cash Flow service") - Cash Flow's Operating
 * section is derived entirely from Payment/Invoice-type ledger postings
 * (services/ledger.ts#getCashFlowStatement), so the exact same
 * known-vs-new payment exception classification the payment
 * reconciliation check already computed tells us everything Cash Flow
 * health needs: a known exception explains an already-understood
 * historical understatement, a new one is an unexplained current gap.
 */
function buildCashFlowCheck(
  cashAccountsConfigured: boolean,
  knownExceptions: PaymentExceptionRow[],
  newExceptions: PaymentExceptionRow[]
): CashFlowReconciliationCheck {
  const knownGapAmount = knownExceptions.reduce((sum, r) => sum + r.amount, 0);
  const unexplainedGapAmount = newExceptions.reduce((sum, r) => sum + r.amount, 0);

  let status: HealthStatus = "healthy";
  if (!cashAccountsConfigured) status = "warning";
  if (unexplainedGapAmount > EXCEPTION_AMOUNT_TOLERANCE) status = "critical";
  else if (knownGapAmount > EXCEPTION_AMOUNT_TOLERANCE) status = "warning";

  let summary: string;
  let explanation: string;

  if (!cashAccountsConfigured) {
    summary = "No cash/bank ledger account is configured for this clinic.";
    explanation = "Cash Flow cannot report any collections until at least one cash or payment-method account is mapped in Ledger Settings.";
  } else if (status === "critical") {
    summary = `Cash Flow understates historical collections by an unexplained KES ${unexplainedGapAmount.toFixed(2)}.`;
    explanation = "This gap does not correspond to any known historical exception - it means one or more recent payments never posted to the ledger, so Cash Flow's Operating collections figure is currently understated for a reason nobody has reviewed yet. Investigate the posting trigger; do not backfill it automatically.";
  } else if (status === "warning") {
    summary = `Cash Flow understates historical collections by a known KES ${knownGapAmount.toFixed(2)} (already explained).`;
    explanation = "This entire gap corresponds to the known historical payment-ledger exceptions listed above, from before the ledger posting system's Phase P backfill. Cash Flow for periods overlapping those payments' dates is understated by exactly this amount, by design, not by error.";
  } else {
    summary = "Cash Flow collections are fully backed by posted ledger transactions.";
    explanation = "Every payment has a corresponding, correctly-amounted Payment-type ledger posting, so Cash Flow's Operating collections figure reflects every real cash movement.";
  }

  return {
    status,
    summary,
    explanation,
    cashAccountsConfigured,
    knownGapAmount,
    unexplainedGapAmount,
  };
}

/* -------------------------------------- */
/* Ledger integrity (Q9)                  */
/* -------------------------------------- */

function buildLedgerIntegrityCheck(row: RawLedgerIntegrityRow): LedgerIntegrityCheck {
  const totalTransactions = Number(row.total_transactions);
  const transactionsWithoutEntries = Number(row.transactions_without_entries);
  const unbalancedTransactions = Number(row.unbalanced_transactions);
  const unbalancedAmount = Number(row.unbalanced_amount);
  const duplicateReferenceGroups = Number(row.duplicate_reference_groups);

  const issueCount = transactionsWithoutEntries + unbalancedTransactions + duplicateReferenceGroups;
  const status: HealthStatus = issueCount > 0 ? "critical" : "healthy";

  return {
    status,
    summary:
      issueCount === 0
        ? `All ${totalTransactions} ledger transactions are balanced and complete.`
        : `${issueCount} ledger integrity issue${issueCount === 1 ? "" : "s"} detected across ${totalTransactions} transactions.`,
    explanation:
      issueCount === 0
        ? "Every transaction's debits equal its credits, every transaction has at least one entry, and no duplicate posting reference was found."
        : "One or more ledger transactions fail the basic double-entry invariant (debits = credits), have no entries at all, or share a duplicate posting reference. This should never happen given the existing posting safeguards - it is new and unexpected, not a known historical exception. Investigate directly in the Ledger; do not attempt an automatic correction.",
    totalTransactions,
    transactionsWithoutEntries,
    unbalancedTransactions,
    unbalancedAmount,
    duplicateReferenceGroups,
  };
}

/* -------------------------------------- */
/* Composition                            */
/* -------------------------------------- */

/**
 * The Accounting Health report - a single, composed snapshot of every
 * detect-only reconciliation check DentalFlow has (Phase Q1). Reuses the
 * existing getArReconciliationStatus()/getPaymentLedgerReconciliation()
 * primitives rather than re-deriving AR/payment totals, and adds three
 * new bounded, read-only RPCs (0085-0087) only for the detail no
 * existing aggregate exposes (which specific invoices/payments are
 * exceptions, and per-transaction ledger balance integrity).
 *
 * Exactly 6 network round trips regardless of clinic size - no
 * per-invoice or per-payment fetch, so this stays fast even for a clinic
 * with thousands of invoices (Q14). Never writes anything.
 */
export async function getAccountingHealthReport(): Promise<AccountingHealthReport> {
  await assertPermission("ledger");

  const clinicId = await getCurrentClinicId();

  const [arStatus, paymentReconciliation, settings, invoiceRowsResult, paymentRowsResult, integrityResult] =
    await Promise.all([
      getArReconciliationStatus(),
      getPaymentLedgerReconciliation(),
      getLedgerSettings(),
      supabase.rpc("get_invoice_consistency_exceptions", { p_clinic_id: clinicId }),
      supabase.rpc("get_payment_ledger_exceptions", { p_clinic_id: clinicId }),
      supabase.rpc("get_ledger_integrity_summary", { p_clinic_id: clinicId }),
    ]);

  if (invoiceRowsResult.error) {
    logError("[accountingHealth] get_invoice_consistency_exceptions failed:", invoiceRowsResult.error);
    throw toError(invoiceRowsResult.error);
  }

  if (paymentRowsResult.error) {
    logError("[accountingHealth] get_payment_ledger_exceptions failed:", paymentRowsResult.error);
    throw toError(paymentRowsResult.error);
  }

  if (integrityResult.error) {
    logError("[accountingHealth] get_ledger_integrity_summary failed:", integrityResult.error);
    throw toError(integrityResult.error);
  }

  const invoiceRows = (invoiceRowsResult.data ?? []) as RawInvoiceConsistencyRow[];
  const paymentExceptionRows = ((paymentRowsResult.data ?? []) as RawPaymentExceptionRow[]).map(
    toPaymentExceptionRow
  );
  const integrityRow = (integrityResult.data?.[0] ?? {
    total_transactions: 0,
    transactions_without_entries: 0,
    unbalanced_transactions: 0,
    unbalanced_amount: 0,
    duplicate_reference_groups: 0,
    duplicate_reference_transactions: 0,
  }) as RawLedgerIntegrityRow;

  const paymentCheck = buildPaymentReconciliationCheck(paymentReconciliation, paymentExceptionRows);
  const cashAccountsConfigured =
    !!settings.default_cash_account_id || Object.keys(settings.payment_method_accounts ?? {}).length > 0;

  const checks: AccountingHealthChecks = {
    arReconciliation: buildArCheck(arStatus),
    paymentReconciliation: paymentCheck,
    invoiceConsistency: buildInvoiceConsistencyCheck(invoiceRows),
    historicalExceptions: buildHistoricalExceptionsCheck(paymentExceptionRows),
    overpayments: buildOverpaymentsCheck(invoiceRows),
    cashFlowReconciliation: buildCashFlowCheck(
      cashAccountsConfigured,
      paymentCheck.knownExceptions,
      paymentCheck.newExceptions
    ),
    ledgerIntegrity: buildLedgerIntegrityCheck(integrityRow),
  };

  const statuses = Object.values(checks).map((c) => c.status);

  const summary = {
    healthyChecks: statuses.filter((s) => s === "healthy").length,
    warningChecks: statuses.filter((s) => s === "warning").length,
    criticalChecks: statuses.filter((s) => s === "critical").length,
  };

  const overallStatus: HealthStatus = statuses.includes("critical")
    ? "critical"
    : statuses.includes("warning")
      ? "warning"
      : "healthy";

  return {
    overallStatus,
    checkedAt: new Date().toISOString(),
    checks,
    summary,
  };
}
