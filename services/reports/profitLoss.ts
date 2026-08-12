import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, getPeriodFinancials, periodLabel } from "./shared";

/**
 * IMPORTANT ACCOUNTING DISTINCTION (per spec): this is a different, less
 * conservative "Gross Profit" than Treatment Profitability's own summary
 * card. Treatment Profitability's Gross Profit only counts revenue from
 * treatments that HAVE a configured direct cost (excluding the rest of
 * revenue entirely, so it never overstates profit). A clinic P&L instead
 * follows the standard accounting shape - full revenue minus whatever
 * direct costs are actually known - and discloses incomplete cost
 * coverage explicitly rather than shrinking the revenue line to match.
 * Both figures are correct for what they each measure; they are
 * deliberately not required to match, and the notice below says so.
 */
export async function generateProfitLossReport(
  period: ReportPeriod,
  _filters: ReportFilters
): Promise<ReportResult> {
  const [clinicMeta, financials] = await Promise.all([
    getClinicMeta(),
    getPeriodFinancials(period.start, period.end),
  ]);

  const grossMargin =
    financials.revenue > 0 ? (financials.grossProfit / financials.revenue) * 100 : null;

  const netMargin =
    financials.revenue > 0 ? (financials.netProfit / financials.revenue) * 100 : null;

  const rows = [
    { line: "Revenue", amount: financials.revenue },
    { line: "Direct Treatment Costs", amount: -financials.directCosts },
    { line: "Gross Profit", amount: financials.grossProfit },
    { line: "Operating Expenses", amount: -financials.expenses },
    { line: "Net Profit", amount: financials.netProfit },
  ];

  const notices: ReportResult["notices"] = [
    {
      tone: "info",
      message:
        "Gross Profit here is Revenue minus known Direct Treatment Costs, minus Operating Expenses gives Net Profit - this is a different, standard-accounting figure from Treatment Profitability's own Gross Profit card, which counts only revenue from treatments with a configured cost. Both are intentional and correct for their own purpose.",
    },
  ];

  if (
    financials.costCoveragePercent != null &&
    financials.costCoveragePercent < 100
  ) {
    notices.push({
      tone: "warning",
      message: `Direct treatment costs are configured for only ${Math.round(
        financials.costCoveragePercent
      )}% of treatment revenue in this period. Gross Profit and Net Profit understate true direct costs for the uncosted portion - configure more treatment costs on the Treatment Profitability page for a fuller picture.`,
    });
  } else if (financials.costCoveragePercent == null) {
    notices.push({
      tone: "warning",
      message:
        "No treatment direct costs are configured yet. Direct Treatment Costs is shown as 0, so Gross Profit and Net Profit here are not yet a complete picture.",
    });
  }

  return {
    id: "profit-loss",
    title: "Profit & Loss",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      {
        label: "Revenue",
        value: currencyValue(financials.revenue, clinicMeta.currency),
      },
      {
        label: "Gross Profit",
        value: currencyValue(financials.grossProfit, clinicMeta.currency),
        subtitle: grossMargin != null ? `${grossMargin.toFixed(1)}% margin` : undefined,
      },
      {
        label: "Net Profit",
        value: currencyValue(financials.netProfit, clinicMeta.currency),
        subtitle: netMargin != null ? `${netMargin.toFixed(1)}% margin` : undefined,
      },
    ],

    columns: [
      { key: "line", label: "Line Item", format: "text" },
      { key: "amount", label: "Amount", format: "currency" },
    ],
    rows,

    notices,
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
