/**
 * Accounting Health - Phase Q. A read-only DETECTION layer over the
 * existing reconciliation primitives (getArReconciliationStatus,
 * getPaymentLedgerReconciliation, and three new bounded read-only RPCs -
 * see services/accountingHealth.ts). It never writes a correction, a
 * journal entry, or a reconciliation-issue row - every check here only
 * ever reports what it finds.
 *
 * The central idea (Q5): a reconciliation gap is either a KNOWN
 * historical exception (Phase P's deliberately-scoped, user-approved
 * backfill left exactly 4 invoices/6 payments unposted - see
 * KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS in the service) or a genuinely NEW
 * discrepancy nobody has reviewed. The two must never be conflated: a
 * known exception is a "warning" (something to be aware of, already
 * explained), a new one is "critical" (something to investigate).
 */

export type HealthStatus = "healthy" | "warning" | "critical";

interface HealthCheckBase {
  status: HealthStatus;
  /** WHAT happened - one short sentence (Q12). */
  summary: string;
  /** WHY it matters, whether it's new or historical, and what action (if
   * any) is appropriate - one short paragraph (Q12). */
  explanation: string;
}

export interface ArReconciliationCheck extends HealthCheckBase {
  ledgerBalance: number;
  invoiceOutstandingBalance: number;
  difference: number;
  matches: boolean;
}

/** A single canonical historical exception definition - see
 * KNOWN_HISTORICAL_PAYMENT_EXCEPTIONS in services/accountingHealth.ts.
 * Never rendered directly by a UI component from a hardcoded list - the
 * UI only ever reads this typed, service-computed shape. */
export interface KnownPaymentException {
  /**
   * Full-app audit fix H11: invoice numbers restart at 1 per clinic
   * (generateInvoiceNumber(), services/billing.ts), so matching by
   * invoiceNumber alone could silently downgrade a genuinely new
   * exception on an unrelated clinic that happens to reach the same
   * invoice number with a coincidentally matching amount. Every entry is
   * scoped to the one specific clinic it was written for and can never
   * match anywhere else.
   */
  clinicId: string;
  invoiceNumber: string;
  amount: number;
  reason: string;
}

export interface PaymentExceptionRow {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  exceptionType: "missing" | "mismatched" | "duplicate";
}

export interface PaymentReconciliationCheck extends HealthCheckBase {
  totalPayments: number;
  postedPayments: number;
  missingPayments: number;
  mismatchedPayments: number;
  duplicatePayments: number;
  totalPaymentAmount: number;
  missingPaymentAmount: number;
  matches: boolean;
  /** Live exceptions that match a known historical exception exactly
   * (same invoice, same amount, same "missing" classification). */
  knownExceptions: PaymentExceptionRow[];
  /** Live exceptions that do NOT match anything in the known list - a
   * different invoice, a different amount, or a mismatched/duplicate
   * posting (never a category any known exception belongs to). This is
   * what actually drives this check's status to "critical". */
  newExceptions: PaymentExceptionRow[];
}

export interface HistoricalExceptionEntry {
  invoiceNumber: string;
  knownAmount: number;
  reason: string;
  /** Whether this exact exception (same amount, still unposted) is still
   * present in the live data right now. */
  currentlyPresent: boolean;
  /** The live unposted amount currently found for this invoice, or null
   * if nothing is currently outstanding for it (resolved, or never
   * matched at all). */
  currentAmount: number | null;
}

export interface HistoricalExceptionsCheck extends HealthCheckBase {
  entries: HistoricalExceptionEntry[];
}

export interface InvoiceConsistencyIssue {
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  issue: string;
  total: number;
  amountPaid: number;
  balance: number;
  status: string;
}

export interface InvoiceConsistencyCheck extends HealthCheckBase {
  issues: InvoiceConsistencyIssue[];
}

export interface OverpaymentRow {
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  total: number;
  amountPaid: number;
  balance: number;
  amountOverpaid: number;
  isKnownException: boolean;
}

export interface OverpaymentsCheck extends HealthCheckBase {
  overpayments: OverpaymentRow[];
  totalOverpaid: number;
}

export interface CashFlowReconciliationCheck extends HealthCheckBase {
  cashAccountsConfigured: boolean;
  /** Sum of currently-missing/mismatched/duplicate payment amounts that
   * match a known historical exception - Cash Flow understates
   * collections by (at most) this much for a reason already explained. */
  knownGapAmount: number;
  /** Sum of currently-missing/mismatched/duplicate payment amounts that
   * do NOT match any known exception - an unexplained current gap. */
  unexplainedGapAmount: number;
}

export interface LedgerIntegrityCheck extends HealthCheckBase {
  totalTransactions: number;
  transactionsWithoutEntries: number;
  unbalancedTransactions: number;
  unbalancedAmount: number;
  duplicateReferenceGroups: number;
}

export interface ExpenseExceptionRow {
  expenseId: string;
  description: string;
  amount: number;
  exceptionType: "missing" | "mismatched" | "duplicate";
}

/** FIN-3.9: the expense-side sibling of PaymentReconciliationCheck, backed
 * by get_expense_ledger_exceptions() (migration 0095). Unlike payments,
 * there is no known/accepted historical exception category here - FIN-3.3's
 * backfill (migrations 0091/0092) posted every expense that predated the
 * ledger posting triggers, so any exception found now is new. */
export interface ExpenseReconciliationCheck extends HealthCheckBase {
  exceptions: ExpenseExceptionRow[];
  totalExceptionAmount: number;
}

export interface AccountingHealthChecks {
  arReconciliation: ArReconciliationCheck;
  paymentReconciliation: PaymentReconciliationCheck;
  invoiceConsistency: InvoiceConsistencyCheck;
  historicalExceptions: HistoricalExceptionsCheck;
  overpayments: OverpaymentsCheck;
  cashFlowReconciliation: CashFlowReconciliationCheck;
  ledgerIntegrity: LedgerIntegrityCheck;
  expenseReconciliation: ExpenseReconciliationCheck;
}

export interface AccountingHealthSummary {
  healthyChecks: number;
  warningChecks: number;
  criticalChecks: number;
}

export interface AccountingHealthReport {
  overallStatus: HealthStatus;
  checkedAt: string;
  checks: AccountingHealthChecks;
  summary: AccountingHealthSummary;
}
