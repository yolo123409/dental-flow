import {
  getAccountLedger,
  getAllLedgerTransactions,
  getBalanceSheet,
  getEbitEbitda,
  getLedgerSettings,
  getProfitAndLoss,
} from "./ledger";
import { getAccountsReceivableReport } from "./accountsReceivable";
import { assertPermission } from "./authorization";

import { FinancialRatiosReport, RatioValue } from "@/types/financialRatios";

const DAY_MS = 24 * 60 * 60 * 1000;

function ratio(numerator: number, denominator: number, reason: string): RatioValue {
  return denominator !== 0
    ? { value: numerator / denominator, unavailableReason: null }
    : { value: null, unavailableReason: reason };
}

function percentRatio(numerator: number, denominator: number, reason: string): RatioValue {
  const r = ratio(numerator, denominator, reason);
  return r.value === null ? r : { value: r.value * 100, unavailableReason: null };
}

function unavailable(reason: string): RatioValue {
  return { value: null, unavailableReason: reason };
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days spanned by the period, inclusive of both ends -
 * computed from local calendar dates rather than raw millisecond
 * division, so a "This Month"/"This Year" range (which ends "now",
 * partway through today, per services/analytics/dateRange.ts) still
 * counts today as a full day. This is what makes AR/AP Days scale with
 * the actual selected period instead of a fixed 365-day assumption.
 */
function periodDayCount(start: Date, end: Date): number {
  const days = Math.round((toMidnight(end).getTime() - toMidnight(start).getTime()) / DAY_MS) + 1;
  return Math.max(days, 1);
}

/**
 * Financial Ratios - entirely a read-only composition over reports that
 * already exist: getBalanceSheet() for every point-in-time figure
 * (Current/Quick Ratio, Debt-to-Equity, Debt Ratio, and the
 * beginning/ending snapshots ROA/ROE average), getProfitAndLoss() and
 * getEbitEbitda() for Revenue/Gross Profit/EBIT/EBITDA/Net Profit
 * (copied verbatim, never recomputed), and getAccountsReceivableReport()
 * for Collection Rate's Amount Invoiced/Amount Collected (the exact same
 * authoritative figures the Accounts Receivable report itself shows).
 *
 * AR Days and AP Days need a period-specific *average* balance, which no
 * existing report exposes directly, so those two reuse
 * getAccountLedger() (already used by the General Ledger page) for the
 * Accounts Receivable/Accounts Payable accounts' opening and closing
 * balance over the selected period - the same ledger accounts every
 * other report already treats as authoritative, not a new account or a
 * second bookkeeping system. AP Days' "purchases" figure sums the actual
 * credit entries posted to the Accounts Payable account in the period
 * (via getLedgerTransactions(), the same function Cash Flow already uses
 * to classify cash-touching transactions) - real recorded liability
 * increases, never an estimate.
 */
export async function getFinancialRatiosReport(
  start: Date,
  end: Date,
  periodLabel: string
): Promise<FinancialRatiosReport> {
  await assertPermission("ledger");

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);
  const dayBeforeStart = new Date(start.getTime() - DAY_MS);
  const days = periodDayCount(start, end);

  const [settings, bsEnd, bsBeginning, profitAndLoss, ebitEbitda, arReport] = await Promise.all([
    getLedgerSettings(),
    getBalanceSheet(end),
    getBalanceSheet(dayBeforeStart),
    getProfitAndLoss(start, end),
    getEbitEbitda(start, end),
    getAccountsReceivableReport(start, end, periodLabel),
  ]);

  const receivableId = settings.accounts_receivable_account_id;
  const payableId = settings.accounts_payable_account_id;
  const cashAccountIds = new Set<string>(
    [settings.default_cash_account_id, ...Object.values(settings.payment_method_accounts ?? {})].filter(
      (id): id is string => !!id
    )
  );

  const [receivableLedger, payableLedger, payableTransactions] = await Promise.all([
    receivableId ? getAccountLedger(receivableId, startIso, endIso) : Promise.resolve(null),
    payableId ? getAccountLedger(payableId, startIso, endIso) : Promise.resolve(null),
    payableId
      ? getAllLedgerTransactions({ accountId: payableId, startDate: startIso, endDate: endIso })
      : Promise.resolve(null),
  ]);

  /* ---------------- Liquidity (Balance Sheet as of period end) ---------------- */

  const currentAssets = bsEnd.currentAssets.total;
  const currentLiabilities = bsEnd.currentLiabilities.total;

  const cashAndBank = bsEnd.currentAssets.lines
    .filter((line) => cashAccountIds.has(line.accountId))
    .reduce((sum, line) => sum + line.amount, 0);

  const receivableBalance = bsEnd.currentAssets.lines
    .filter((line) => line.accountId === receivableId)
    .reduce((sum, line) => sum + line.amount, 0);

  const currentRatio = ratio(
    currentAssets,
    currentLiabilities,
    "Not available — no current liabilities recorded as of this date"
  );

  const quickRatio = ratio(
    cashAndBank + receivableBalance,
    currentLiabilities,
    "Not available — no current liabilities recorded as of this date"
  );

  /* ---------------- Profitability ---------------- */

  const revenue = profitAndLoss.revenue.total;
  const netProfit = profitAndLoss.netProfit;

  const grossMarginPercent = percentRatio(
    ebitEbitda.grossProfit,
    revenue,
    "Not available — no revenue recorded for this period"
  );

  const ebitMarginPercent: RatioValue =
    ebitEbitda.ebitMarginPercent === null
      ? unavailable("Not available — no revenue recorded for this period")
      : { value: ebitEbitda.ebitMarginPercent, unavailableReason: null };

  const ebitdaMarginPercent: RatioValue = !ebitEbitda.ebitdaAvailable
    ? unavailable(
        "Not available — Depreciation and Amortization are not currently recorded in this clinic's Chart of Accounts"
      )
    : ebitEbitda.ebitdaMarginPercent === null
      ? unavailable("Not available — no revenue recorded for this period")
      : { value: ebitEbitda.ebitdaMarginPercent, unavailableReason: null };

  const netProfitMarginPercent = percentRatio(
    netProfit,
    revenue,
    "Not available — no revenue recorded for this period"
  );

  const averageTotalAssets = (bsBeginning.totalAssets + bsEnd.totalAssets) / 2;
  const averageTotalEquity = (bsBeginning.totalEquity + bsEnd.totalEquity) / 2;

  const returnOnAssetsPercent = percentRatio(
    netProfit,
    averageTotalAssets,
    "Not available — average total assets are zero for this period"
  );

  const returnOnEquityPercent = percentRatio(
    netProfit,
    averageTotalEquity,
    "Not available — average total equity is zero for this period"
  );

  /* ---------------- Leverage (Balance Sheet as of period end) ---------------- */

  const debtToEquity = ratio(
    bsEnd.totalLiabilities,
    bsEnd.totalEquity,
    "Not available — no equity recorded as of this date"
  );

  const debtRatioPercent = percentRatio(
    bsEnd.totalLiabilities,
    bsEnd.totalAssets,
    "Not available — no assets recorded as of this date"
  );

  /* ---------------- Efficiency / Collection ---------------- */

  let accountsReceivableDays: RatioValue;
  if (!receivableId || !receivableLedger) {
    accountsReceivableDays = unavailable("Not available — no Accounts Receivable account configured");
  } else if (revenue === 0) {
    accountsReceivableDays = unavailable("Not available — no revenue recorded for this period");
  } else {
    const averageReceivable = (receivableLedger.openingBalance + receivableLedger.closingBalance) / 2;
    accountsReceivableDays = { value: (averageReceivable / revenue) * days, unavailableReason: null };
  }

  const collectionRatePercent = percentRatio(
    arReport.totalCollected,
    arReport.totalInvoiced,
    "Not available — no invoiced amount recorded for this period"
  );

  let accountsPayableDays: RatioValue;
  if (!payableId || !payableLedger || !payableTransactions) {
    accountsPayableDays = unavailable("Not available — no Accounts Payable account configured");
  } else {
    const purchases = payableTransactions.reduce((sum, txn) => {
      const entries = txn.clinic_ledger_entries ?? [];
      const payableCredits = entries
        .filter((entry) => entry.account_id === payableId)
        .reduce((entrySum, entry) => entrySum + Number(entry.credit), 0);
      return sum + payableCredits;
    }, 0);

    if (purchases === 0) {
      accountsPayableDays = unavailable(
        "Not available — no purchases recorded against the Accounts Payable account in this period"
      );
    } else {
      const averagePayable = -(payableLedger.openingBalance + payableLedger.closingBalance) / 2;
      accountsPayableDays = { value: (averagePayable / purchases) * days, unavailableReason: null };
    }
  }

  return {
    periodLabel,
    periodStart: startIso,
    periodEnd: endIso,
    balanceSheetAsOf: bsEnd.asOf,

    liquidity: { currentRatio, quickRatio },

    profitability: {
      grossMarginPercent,
      ebitMarginPercent,
      ebitdaMarginPercent,
      netProfitMarginPercent,
      returnOnAssetsPercent,
      returnOnEquityPercent,
    },

    leverage: { debtToEquity, debtRatioPercent },

    efficiency: { accountsReceivableDays, collectionRatePercent, accountsPayableDays },
  };
}
