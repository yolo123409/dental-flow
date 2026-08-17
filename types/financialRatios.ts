/**
 * Financial Ratios - a read-only composition over already-existing
 * reports (Balance Sheet, P&L, EBIT/EBITDA, Accounts Receivable, and the
 * ledger's own Accounts Payable account), not a fourth/fifth accounting
 * calculation. Every ratio's numerator/denominator is either copied
 * verbatim from one of those reports or derived from the same
 * clinic_ledger_entries/transactions tables those reports already read,
 * using the same already-exported ledger functions (getAccountLedger,
 * getLedgerTransactions) other reports use for the same purpose.
 *
 * `RatioValue.value` is null whenever the ratio cannot be reliably
 * computed (a zero or missing denominator, or a required account that
 * hasn't been configured) - `unavailableReason` explains why in plain
 * language. `value` is never NaN/Infinity/-Infinity, and a missing input
 * is never silently substituted with zero.
 */
export interface RatioValue {
  value: number | null;
  unavailableReason: string | null;
}

export interface FinancialRatiosReport {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** The Balance Sheet date used for every point-in-time ratio below (Current/Quick Ratio, Debt-to-Equity, Debt Ratio) - the selected period's end date. */
  balanceSheetAsOf: string;

  liquidity: {
    /** Current Assets / Current Liabilities, both from the Balance Sheet as of period end. */
    currentRatio: RatioValue;
    /** (Cash & Bank + Accounts Receivable) / Current Liabilities, from the Balance Sheet's own current-asset classification - excludes Inventory. */
    quickRatio: RatioValue;
  };

  profitability: {
    /** Gross Profit / Revenue x 100 - byte-identical inputs to the Margins & Markup report. */
    grossMarginPercent: RatioValue;
    /** EBIT Margin, copied verbatim from getEbitEbitda() - never recomputed. */
    ebitMarginPercent: RatioValue;
    /** EBITDA Margin, copied verbatim from getEbitEbitda() - null (with reason) whenever EBITDA itself is unavailable, never substituted with EBIT Margin. */
    ebitdaMarginPercent: RatioValue;
    /** Net Profit / Revenue x 100, from the P&L. */
    netProfitMarginPercent: RatioValue;
    /** Net Profit / Average Total Assets x 100. Average = (Balance Sheet total assets the day before the period started + Balance Sheet total assets as of period end) / 2 - both real Balance Sheet snapshots, never fabricated. */
    returnOnAssetsPercent: RatioValue;
    /** Net Profit / Average Total Equity x 100, same averaging approach as ROA. */
    returnOnEquityPercent: RatioValue;
  };

  leverage: {
    /** Total Liabilities / Total Equity, from the Balance Sheet as of period end. */
    debtToEquity: RatioValue;
    /** Total Liabilities / Total Assets x 100, from the Balance Sheet as of period end. */
    debtRatioPercent: RatioValue;
  };

  efficiency: {
    /** Average Accounts Receivable / Revenue x Number of Days in the selected period - not a fixed 365-day multiplier. */
    accountsReceivableDays: RatioValue;
    /** Amount Collected / Amount Invoiced x 100, using the exact same totalCollected/totalInvoiced the Accounts Receivable report already computes for this period. */
    collectionRatePercent: RatioValue;
    /** Average Accounts Payable / ledger-recorded Accounts Payable purchases x Number of Days in the selected period. */
    accountsPayableDays: RatioValue;
  };
}
