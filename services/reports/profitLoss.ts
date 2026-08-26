import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, getPeriodFinancials, periodLabel } from "./shared";

/**
 * IMPORTANT ACCOUNTING DISTINCTION (FIN-1): "Direct Treatment Costs" below
 * is the general ledger's own Supplies Used account - the real cost of
 * inventory actually recorded as consumed (getPeriodFinancials(), backed
 * by services/ledger.ts#getProfitAndLoss) - not Treatment Profitability's
 * own clinic_treatments.direct_cost estimate. The two pages are expected
 * to disagree: Treatment Profitability's Gross Profit only counts revenue
 * from treatments with a manually-configured cost estimate (a rough,
 * catalog-level figure); this P&L instead reports the clinic's actual,
 * ledger-recorded direct costs against full revenue. Neither is "wrong" -
 * they measure different things.
 *
 * Before FIN-1 this report used the SAME direct_cost estimate Treatment
 * Profitability uses, which meant this "Profit & Loss" and the Ledger's
 * own Profit & Loss page could report different Net Profit for the same
 * period (see the FIN-0 audit, finding P1-1). This report now shares
 * getProfitAndLoss() with the Ledger P&L page instead, so the two can
 * never disagree.
 *
 * Recording inventory as consumed (rather than just purchased) during a
 * treatment is currently a manual, optional step elsewhere in the app
 * (see the FIN-0 audit, finding P1-2) - if a clinic isn't recording
 * consumption, Direct Treatment Costs below will legitimately read low or
 * zero, exactly as the Ledger P&L would for the same period. That is a
 * real operational gap, not a bug in this report, and building the
 * treatment-to-inventory link is out of scope for FIN-1 (planned for
 * FIN-2).
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
        "Revenue, Direct Treatment Costs, and Operating Expenses here come from the general ledger - the same accounting source as the Ledger's own Profit & Loss report, so this figure always agrees with it for the same period. This is a different figure from Treatment Profitability's own Gross Profit card, which only counts revenue from treatments with a manually configured cost estimate; both are intentional and measure different things.",
    },
  ];

  if (financials.directCosts === 0) {
    notices.push({
      tone: "warning",
      message:
        "No inventory consumption has been recorded against the ledger's Supplies Used account for this period, so Direct Treatment Costs shows as 0. Gross Profit and Net Profit above do not yet reflect real material costs.",
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
