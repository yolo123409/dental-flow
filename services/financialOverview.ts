import { getProfitAndLoss, getLedgerDashboardTotals } from "./ledger";
import { getAccountsReceivableReport } from "./accountsReceivable";
import { getFinancialRatiosReport } from "./financialRatios";
import { getArSummary, getDiscountTotal } from "./billing";
import { getRevenueAnalyticsForPeriod } from "./analytics/revenue";
import { getRevenueChartData, RevenueChartPoint } from "./analytics/charts";
import { getTreatmentProfitabilityReportForPeriod } from "./treatmentProfitability";
import { getCurrentOrganizationUser, getOrganizationFinancials } from "./organizations";
import { assertPermission } from "./authorization";
import { getPreviousPeriodFor, percentChange, ResolvedPeriod } from "@/lib/reports/period";
import { ArSummary } from "./billing";
import { RatioValue } from "@/types/financialRatios";
import { OrganizationFinancials } from "@/types/organization";

/**
 * Phase L: a pure composition layer over already-authoritative services -
 * every figure below is either copied verbatim from an existing report or
 * a trivial derived ratio/percentage of two such figures (the same kind of
 * one-line division getFinancialRatiosReport/getAccountsReceivableReport
 * already do internally). This file writes to nothing and introduces no
 * new accounting rule - it only decides WHICH existing services to call
 * and how to lay their results side by side for one dashboard.
 */

export interface FinancialOverviewFigures {
  /** Accrual revenue for the period - Treatment Revenue account net
   * credit movement, from getProfitAndLoss() directly (getLedgerDashboardTotals()
   * also exposes the identical figure post-FIN-1, but this file calls
   * getProfitAndLoss() itself since it separately needs grossProfit/netProfit
   * from the same result). */
  revenue: number;
  grossProfit: number;
  netProfit: number;
  /** Same figure as `revenue` above (both are the Treatment Revenue
   * account's net credit movement for the period), kept as its own field
   * because it's also used in the Reconciliation section (check C). */
  totalInvoiced: number;
  /** Real cash collected against Accounts Receivable in the period (Cash
   * Flow's Operating section), from getAccountsReceivableReport(). */
  totalCollected: number;
  grossMarginPercent: RatioValue;
  netProfitMarginPercent: RatioValue;
  collectionRatePercent: RatioValue;
  /** Tax on Paid invoices in the period - "Collected" basis, since there
   * is no Tax Payable ledger account to report an accrual/liability
   * figure from (confirmed absent from LedgerSettings). */
  vatCollected: number;
  discountTotal: number;
}

export interface FinancialOverviewComparison {
  previousLabel: string;
  revenueChangePercent: number | null;
  collectedChangePercent: number | null;
}

export interface FinancialOverviewTreatmentRow {
  name: string;
  revenue: number;
  performedCount: number;
  percentOfTotal: number;
}

export interface FinancialOverviewReconciliationCheck {
  key: string;
  label: string;
  expected: number;
  actual: number;
  difference: number;
  matches: boolean;
  note: string;
}

export type ArRiskLevel = "Healthy AR" | "Attention Required" | "High Aging Exposure" | "No Outstanding AR";

export interface FinancialOverview {
  periodLabel: string;
  current: FinancialOverviewFigures;
  comparison: FinancialOverviewComparison | null;

  cashAndBank: number;
  accountsPayable: number;
  inventory: number;
  openReconciliationIssues: number;

  ar: ArSummary;
  arRiskLevel: ArRiskLevel;
  arAgingOver60Percent: number | null;

  topTreatments: FinancialOverviewTreatmentRow[];

  /** Null when the selected range is "Custom Range" - getRevenueChartData
   * only understands named ranges (see the guard in the page). */
  chart: RevenueChartPoint[] | null;

  branchPerformance: OrganizationFinancials | null;

  reconciliation: FinancialOverviewReconciliationCheck[];
  reconciled: boolean;
}

// A tolerance of 1 currency unit (not 0.00) absorbs rounding differences
// between roundMoney()'s 2dp rounding and the ledger's own numeric(12,2)
// storage - never used to paper over a genuine discrepancy, which would
// be orders of magnitude larger than a rounding cent.
const RECONCILIATION_TOLERANCE = 1;

function reconciliationCheck(
  key: string,
  label: string,
  expected: number,
  actual: number,
  note: string
): FinancialOverviewReconciliationCheck {
  const difference = actual - expected;

  return {
    key,
    label,
    expected,
    actual,
    difference,
    matches: Math.abs(difference) <= RECONCILIATION_TOLERANCE,
    note,
  };
}

function arRiskLevelFor(ar: ArSummary): { level: ArRiskLevel; over60Percent: number | null } {
  if (ar.totalOutstanding <= 0) {
    return { level: "No Outstanding AR", over60Percent: null };
  }

  const over60 = ar.buckets
    .filter((b) => b.key === "61-90" || b.key === "90+")
    .reduce((sum, b) => sum + b.amount, 0);

  const percent = (over60 / ar.totalOutstanding) * 100;

  // Fixed, documented thresholds - not a proprietary score. Chosen so
  // "Healthy" means the overwhelming majority of AR is still fresh
  // (<=60 days), "Attention Required" flags a meaningful but not yet
  // dominant older slice, and "High Aging Exposure" means over a third of
  // every outstanding shilling has been sitting for more than 60 days.
  const level: ArRiskLevel = percent <= 10 ? "Healthy AR" : percent <= 30 ? "Attention Required" : "High Aging Exposure";

  return { level, over60Percent: percent };
}

export async function getFinancialOverview(
  period: ResolvedPeriod,
  rangeLabel: string
): Promise<FinancialOverview> {
  await assertPermission("ledger");

  const { start, end, label } = period;
  const previousPeriod = getPreviousPeriodFor(rangeLabel, period);

  const chartPromise: Promise<RevenueChartPoint[] | null> =
    rangeLabel === "Custom Range" ? Promise.resolve(null) : getRevenueChartData(rangeLabel);

  const orgUserPromise = getCurrentOrganizationUser().catch(() => null);

  const [
    profitAndLoss,
    arReport,
    ratios,
    dashboardTotals,
    ar,
    revenueAnalytics,
    discountTotal,
    treatmentReport,
    chart,
    previousPnl,
    previousArReport,
    orgUser,
  ] = await Promise.all([
    getProfitAndLoss(start, end),
    getAccountsReceivableReport(start, end, label),
    getFinancialRatiosReport(start, end, label),
    getLedgerDashboardTotals(start, end),
    getArSummary(),
    getRevenueAnalyticsForPeriod(start, end),
    getDiscountTotal(start, end),
    getTreatmentProfitabilityReportForPeriod(start, end, rangeLabel),
    chartPromise,
    getProfitAndLoss(previousPeriod.start, previousPeriod.end),
    getAccountsReceivableReport(previousPeriod.start, previousPeriod.end, previousPeriod.label),
    orgUserPromise,
  ]);

  const current: FinancialOverviewFigures = {
    revenue: profitAndLoss.revenue.total,
    grossProfit: profitAndLoss.grossProfit,
    netProfit: profitAndLoss.netProfit,
    totalInvoiced: arReport.totalInvoiced,
    totalCollected: arReport.totalCollected,
    grossMarginPercent: ratios.profitability.grossMarginPercent,
    netProfitMarginPercent: ratios.profitability.netProfitMarginPercent,
    collectionRatePercent: ratios.efficiency.collectionRatePercent,
    vatCollected: revenueAnalytics.totalTaxCollected,
    discountTotal,
  };

  const comparison: FinancialOverviewComparison = {
    previousLabel: previousPeriod.label,
    revenueChangePercent: percentChange(profitAndLoss.revenue.total, previousPnl.revenue.total),
    collectedChangePercent: percentChange(arReport.totalCollected, previousArReport.totalCollected),
  };

  const { level: arRiskLevel, over60Percent: arAgingOver60Percent } = arRiskLevelFor(ar);

  const performedTreatments = treatmentReport.rows
    .filter((row) => row.performedCount > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const treatmentTotalRevenue = treatmentReport.summary.totalRevenue;

  const topTreatments: FinancialOverviewTreatmentRow[] = performedTreatments.map((row) => ({
    name: row.name,
    revenue: row.revenue,
    performedCount: row.performedCount,
    percentOfTotal: treatmentTotalRevenue > 0 ? (row.revenue / treatmentTotalRevenue) * 100 : 0,
  }));

  let branchPerformance: OrganizationFinancials | null = null;

  if (orgUser && orgUser.role === "CEO") {
    try {
      branchPerformance = await getOrganizationFinancials(orgUser.organization_id, start, end);
    } catch {
      branchPerformance = null;
    }
  }

  const reconciliation: FinancialOverviewReconciliationCheck[] = [
    reconciliationCheck(
      "ar-ledger-vs-invoices",
      "Ledger AR Balance vs. Outstanding Invoice Balances",
      arReport.reconciliation.ledgerBalance,
      arReport.reconciliation.invoiceOutstandingBalance,
      "The Accounts Receivable ledger account's balance should equal the sum of every currently-outstanding invoice's balance."
    ),
    reconciliationCheck(
      "ar-report-vs-live-ar",
      "Ledger AR Report vs. Live Billing AR (Phase K)",
      arReport.reconciliation.invoiceOutstandingBalance,
      ar.totalOutstanding,
      "Two independent reads of the same outstanding-invoice balances (one from the Ledger's AR report, one from the Billing Control Center's AR view) should always agree exactly."
    ),
    reconciliationCheck(
      "revenue-vs-ar-invoiced",
      "P&L Revenue vs. AR Report Invoiced",
      profitAndLoss.revenue.total,
      arReport.totalInvoiced,
      "Both figures are the Treatment Revenue account's net credit movement for the selected period, computed via two different report functions."
    ),
  ];

  const reconciled = reconciliation.every((c) => c.matches) && dashboardTotals.openReconciliationIssues === 0;

  return {
    periodLabel: label,
    current,
    comparison,
    cashAndBank: dashboardTotals.cashAndBank,
    accountsPayable: dashboardTotals.accountsPayable,
    inventory: dashboardTotals.inventory,
    openReconciliationIssues: dashboardTotals.openReconciliationIssues,
    ar,
    arRiskLevel,
    arAgingOver60Percent,
    topTreatments,
    chart,
    branchPerformance,
    reconciliation,
    reconciled,
  };
}
