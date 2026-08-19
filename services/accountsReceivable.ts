import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getCashFlowStatement, getLedgerSettings, getProfitAndLoss, getTrialBalance } from "./ledger";
import { assertPermission } from "./authorization";

import { ArAging, ArAgingBucket, ArInvoiceRow, ArReconciliation, ArReport } from "@/types/accountsReceivable";

interface RawOutstandingInvoiceRow {
  id: string;
  invoice_number: string;
  created_at: string;
  total: number;
  amount_paid: number;
  balance: number;
  patient_id: string;
  patients: { first_name: string; last_name: string } | null;
}

/**
 * Every currently-outstanding invoice (balance > 0), read directly from
 * clinic_invoices - the only place per-invoice AR detail exists (the
 * ledger's Accounts Receivable account is a single pooled balance, not
 * itemized per invoice). Filtered on the numeric `balance` column itself
 * rather than the `status` text field, so a paid-off invoice is always
 * excluded even in an edge case where its status string were ever wrong.
 */
async function getOutstandingInvoiceRows(): Promise<ArInvoiceRow[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_invoices")
    .select(
      "id, invoice_number, created_at, total, amount_paid, balance, patient_id, patients ( first_name, last_name )"
    )
    .eq("clinic_id", clinicId)
    .gt("balance", 0)
    .order("created_at", { ascending: true });

  if (error) {
    logError("[accountsReceivable] getOutstandingInvoiceRows failed:", error);
    throw toError(error);
  }

  const now = Date.now();

  return ((data ?? []) as unknown as RawOutstandingInvoiceRow[]).map((row) => {
    const daysOutstanding = Math.max(
      0,
      Math.floor((now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      invoiceId: row.id,
      invoiceNumber: row.invoice_number,
      patientId: row.patient_id,
      patientName: row.patients ? `${row.patients.first_name} ${row.patients.last_name}` : "—",
      invoiceDate: row.created_at,
      dueDate: null,
      invoiceAmount: Number(row.total),
      amountPaid: Number(row.amount_paid),
      outstanding: Number(row.balance),
      daysOutstanding,
      status: daysOutstanding > 30 ? "Overdue" : "Current",
    };
  });
}

function emptyBucket(label: string): ArAgingBucket {
  return { label, amount: 0, count: 0 };
}

function buildAging(invoices: ArInvoiceRow[]): ArAging {
  const aging: ArAging = {
    current: emptyBucket("Current (0 days)"),
    days1to30: emptyBucket("1–30 Days"),
    days31to60: emptyBucket("31–60 Days"),
    days61to90: emptyBucket("61–90 Days"),
    days90plus: emptyBucket("90+ Days"),
  };

  for (const invoice of invoices) {
    const bucket =
      invoice.daysOutstanding <= 0
        ? aging.current
        : invoice.daysOutstanding <= 30
          ? aging.days1to30
          : invoice.daysOutstanding <= 60
            ? aging.days31to60
            : invoice.daysOutstanding <= 90
              ? aging.days61to90
              : aging.days90plus;

    bucket.amount += invoice.outstanding;
    bucket.count += 1;
  }

  return aging;
}

/**
 * Accounts Receivable report - outstanding balance/aging are always as
 * of now (a live snapshot, same as the Ledger dashboard's own AR
 * figure), while Total Invoiced/Total Collected are for the selected
 * reporting period. Read-only throughout: only ever selects from
 * clinic_invoices and reuses existing ledger report functions, never
 * writes anything.
 *
 * Total Outstanding is the ledger's Accounts Receivable account balance
 * (via getTrialBalance - the exact figure getLedgerDashboardTotals
 * already surfaces), per the rule that the ledger is the accounting
 * source of truth for aggregate figures. Per-invoice detail, aging, and
 * the Current/Overdue split necessarily come from clinic_invoices
 * itself, since the ledger doesn't decompose AR by invoice - the
 * reconciliation section below makes the relationship between the two
 * explicit rather than silently forcing them to match.
 */
export async function getAccountsReceivableReport(
  periodStart: Date,
  periodEnd: Date,
  periodLabel: string
): Promise<ArReport> {
  await assertPermission("ledger");

  const [settings, invoices, trialBalance, profitAndLoss, cashFlow] = await Promise.all([
    getLedgerSettings(),
    getOutstandingInvoiceRows(),
    getTrialBalance(),
    getProfitAndLoss(periodStart, periodEnd),
    getCashFlowStatement(periodStart, periodEnd),
  ]);

  const invoiceOutstandingBalance = invoices.reduce((sum, invoice) => sum + invoice.outstanding, 0);

  const receivableId = settings.accounts_receivable_account_id;
  const ledgerBalance = receivableId
    ? (trialBalance.rows.find((row) => row.accountId === receivableId)?.debitBalance ?? 0)
    : 0;

  const revenueAccountId = settings.treatment_revenue_account_id;
  const totalInvoiced = revenueAccountId
    ? (profitAndLoss.revenue.lines.find((line) => line.accountId === revenueAccountId)?.amount ?? 0)
    : 0;

  const totalCollected = receivableId
    ? (cashFlow.operating.lines.find((line) => line.accountId === receivableId)?.amount ?? 0)
    : 0;

  const totalOverdue = invoices
    .filter((invoice) => invoice.status === "Overdue")
    .reduce((sum, invoice) => sum + invoice.outstanding, 0);

  const totalCurrent = invoices
    .filter((invoice) => invoice.status === "Current")
    .reduce((sum, invoice) => sum + invoice.outstanding, 0);

  const difference = ledgerBalance - invoiceOutstandingBalance;

  const reconciliation: ArReconciliation = {
    ledgerBalance,
    invoiceOutstandingBalance,
    difference,
    matches: Math.abs(difference) < 0.01,
  };

  return {
    totalOutstanding: ledgerBalance,
    totalOverdue,
    totalCurrent,
    aging: buildAging(invoices),
    periodLabel,
    totalInvoiced,
    totalCollected,
    invoices,
    reconciliation,
  };
}
