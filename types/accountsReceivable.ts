/**
 * Accounts Receivable - a hybrid report: aggregate totals come from the
 * ledger (clinic_ledger_accounts' Accounts Receivable account, via
 * getTrialBalance/getProfitAndLoss/getCashFlowStatement - the same
 * accounting source of truth as every other financial report), while
 * per-invoice detail is read directly from clinic_invoices since the
 * ledger doesn't decompose AR by individual invoice.
 *
 * Billing audit fix #2: clinic_invoices.due_date (migration 0111) is now
 * real - "days outstanding"/Overdue are measured from it, not from the
 * invoice date. Existing invoices were backfilled to due_date =
 * created_at (due on receipt), so historical behavior is unchanged
 * unless a clinic has since raised its default payment terms.
 */

export type ArInvoiceStatus = "Current" | "Overdue";

export interface ArInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  invoiceDate: string;
  dueDate: string | null;
  invoiceAmount: number;
  amountPaid: number;
  outstanding: number;
  daysOutstanding: number;
  status: ArInvoiceStatus;
}

export interface ArAgingBucket {
  label: string;
  amount: number;
  count: number;
}

export interface ArAging {
  current: ArAgingBucket;
  days1to30: ArAgingBucket;
  days31to60: ArAgingBucket;
  days61to90: ArAgingBucket;
  days90plus: ArAgingBucket;
}

export interface ArReconciliation {
  /** The Accounts Receivable ledger account's current debit balance - the accounting source of truth. */
  ledgerBalance: number;
  /** Sum of clinic_invoices.balance across every currently-outstanding invoice. */
  invoiceOutstandingBalance: number;
  difference: number;
  matches: boolean;
}

export interface ArReport {
  /** Ledger AR balance - authoritative for every summary figure below, per the accounting rule that the ledger is the source of truth. */
  totalOutstanding: number;
  totalOverdue: number;
  totalCurrent: number;

  aging: ArAging;

  periodLabel: string;
  /** Net credit movement on the Treatment Revenue account for the selected period (i.e. invoice-driven revenue only, not all Income). */
  totalInvoiced: number;
  /** Net cash collected against Accounts Receivable for the selected period (the same figure Cash Flow's Operating section already computes). */
  totalCollected: number;

  invoices: ArInvoiceRow[];

  reconciliation: ArReconciliation;
}
