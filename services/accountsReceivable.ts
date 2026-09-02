import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getCashFlowStatement, getLedgerSettings, getProfitAndLoss, getTrialBalance } from "./ledger";
import { getOutstandingInvoiceBalance } from "./billing";
import { assertPermission } from "./authorization";

import { ArAging, ArAgingBucket, ArInvoiceRow, ArReconciliation, ArReport } from "@/types/accountsReceivable";

interface RawOutstandingInvoiceRow {
  id: string;
  invoice_number: string;
  created_at: string;
  due_date: string | null;
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

  // Paged rather than a single unbounded fetch - every individual
  // outstanding invoice's detail is genuinely needed here (both for the
  // aging buckets and the per-invoice AR table), so this can't be
  // reduced to a SQL sum the way pure totals were elsewhere. A clinic
  // with more than 1,000 currently-outstanding invoices would otherwise
  // silently lose rows from both the aging report and the invoice list.
  let data: RawOutstandingInvoiceRow[];

  try {
    data = await fetchAllRows<RawOutstandingInvoiceRow>((from, to) =>
      supabase
        .from("clinic_invoices")
        .select(
          "id, invoice_number, created_at, due_date, total, amount_paid, balance, patient_id, patients ( first_name, last_name )"
        )
        .eq("clinic_id", clinicId)
        .gt("balance", 0)
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: RawOutstandingInvoiceRow[] | null;
        error: unknown;
      }>
    );
  } catch (error) {
    logError("[accountsReceivable] getOutstandingInvoiceRows failed:", error);
    throw error;
  }

  const now = Date.now();

  return data.map((row) => {
    // Billing audit fix #2: aging is now days PAST DUE (0 until the due
    // date has actually passed), not days since the invoice was issued -
    // due_date is backfilled for every invoice (migration 0111), so this
    // always has a real value in practice; the ?? guards only a
    // theoretical null.
    const dueDate = row.due_date ?? row.created_at;
    const daysOutstanding = Math.max(
      0,
      Math.floor((now - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      invoiceId: row.id,
      invoiceNumber: row.invoice_number,
      patientId: row.patient_id,
      patientName: row.patients ? `${row.patients.first_name} ${row.patients.last_name}` : "—",
      invoiceDate: row.created_at,
      dueDate: row.due_date,
      invoiceAmount: Number(row.total),
      amountPaid: Number(row.amount_paid),
      outstanding: Number(row.balance),
      daysOutstanding,
      status: daysOutstanding > 0 ? "Overdue" : "Current",
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

/**
 * Standalone AR reconciliation check - detect only, never corrects.
 *
 * Deliberately NOT a byproduct of getAccountsReceivableReport(): that
 * report fetches every individual outstanding invoice row (needed for
 * aging/detail), which is unnecessary work for a simple "are the two
 * AR figures still equal" check. This calls only the two existing,
 * already-aggregated primitives every part of this app already relies
 * on for these numbers - getTrialBalance()'s per-account balance (the
 * ledger side, backed by RPC get_trial_balance) and
 * getOutstandingInvoiceBalance() (the invoice side, backed by RPC
 * get_outstanding_invoice_balance, migration 0082) - so it stays cheap
 * enough to call on-demand from a dashboard or a periodic check without
 * adding any per-invoice query, and never touches invoice/payment/ledger
 * write paths. It intentionally reuses the same ArReconciliation shape
 * getAccountsReceivableReport() already returns, so both are
 * interchangeable to any caller.
 *
 * Phase O correction: this originally called getInvoiceBalanceTotals()
 * for the invoice side, which nets every invoice's balance together
 * clinic-wide - an overpaid (negative-balance) invoice would silently
 * reduce the reported invoice-side total without any matching change on
 * the ledger side, producing a false "matches: false" reconciliation
 * failure even when the ledger and the real Outstanding AR agree. Now
 * uses getOutstandingInvoiceBalance() (floors each invoice's
 * contribution at zero), the same canonical definition every other AR
 * surface uses.
 *
 * This exists so a gap like the one Phase M found and Phase N's
 * backfill closed (supabase/migrations/0081_backfill_historical_ar_ledger_postings.sql)
 * can be noticed going forward instead of silently reaccumulating. On
 * a future mismatch this returns matches: false with the exact
 * ledger/invoice figures and their difference - callers surface that
 * for someone to investigate. It never writes a correction, a journal
 * entry, or a reconciliation-issue row itself.
 */
export async function getArReconciliationStatus(): Promise<ArReconciliation> {
  await assertPermission("ledger");

  const [settings, trialBalance, invoiceOutstandingBalance] = await Promise.all([
    getLedgerSettings(),
    getTrialBalance(),
    getOutstandingInvoiceBalance(),
  ]);

  const receivableId = settings.accounts_receivable_account_id;
  const ledgerBalance = receivableId
    ? (trialBalance.rows.find((row) => row.accountId === receivableId)?.debitBalance ?? 0)
    : 0;

  const difference = ledgerBalance - invoiceOutstandingBalance;

  return {
    ledgerBalance,
    invoiceOutstandingBalance,
    difference,
    matches: Math.abs(difference) < 0.01,
  };
}
