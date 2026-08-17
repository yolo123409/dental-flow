import { getEbitEbitda, getProfitAndLoss } from "./ledger";
import { getTreatmentProfitabilityReportForPeriod } from "./treatmentProfitability";

import { MarginsMarkupReport, TreatmentMarkupRow } from "@/types/marginsMarkup";
import { TreatmentProfitabilityRow } from "@/types/treatmentProfitability";

const RANKING_SIZE = 5;

function percentOrNull(numerator: number, denominator: number): number | null {
  return denominator !== 0 ? (numerator / denominator) * 100 : null;
}

/**
 * Adds Markup % on top of the Treatment Profitability service's existing
 * catalog fields - it already computes Selling Price/Direct Cost/Gross
 * Profit/Margin %, and already distinguishes "cost not recorded" (null)
 * from "cost recorded as zero" (0), so this only derives one new number.
 * Markup requires a positive direct cost (not merely non-null) - a
 * recorded-zero cost would make markup mathematically infinite, so it is
 * null (never Infinity), same as an unrecorded cost.
 */
function toMarkupRow(row: TreatmentProfitabilityRow): TreatmentMarkupRow {
  const markupPercent =
    row.directCost != null && row.directCost > 0 && row.grossProfitPerUnit != null
      ? (row.grossProfitPerUnit / row.directCost) * 100
      : null;

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    sellingPrice: row.sellingPrice,
    directCost: row.directCost,
    grossProfitPerUnit: row.grossProfitPerUnit,
    marginPercent: row.grossMarginPerUnit,
    markupPercent,
    performedCount: row.performedCount,
    revenueGenerated: row.revenue,
    periodGrossProfit: row.actualGrossProfit,
  };
}

/**
 * Margins & Markup - a read-only composition over three already-existing
 * reports, not a fourth accounting calculation:
 *  - getEbitEbitda() for Revenue/Gross Profit/EBIT/EBITDA and their
 *    margins (reused verbatim - never recomputed here).
 *  - getProfitAndLoss() for Net Profit specifically (Net Profit Margin
 *    must use the P&L's own actual figure, not an assumption that it
 *    equals EBIT).
 *  - getTreatmentProfitabilityReportForPeriod() for every treatment's
 *    catalog price/cost and this period's actual performed count/revenue
 *    - this function only adds Markup % on top (see toMarkupRow above).
 *
 * Rankings never treat an unrecorded cost as zero: every ranking filters
 * to rows with a genuinely computed value first, so a treatment with no
 * configured cost simply cannot appear in any ranking, rather than
 * appearing with a fabricated (and misleadingly extreme) figure.
 */
export async function getMarginsMarkupReport(
  start: Date,
  end: Date,
  periodLabel: string
): Promise<MarginsMarkupReport> {
  const [ebitEbitda, profitAndLoss, treatmentReport] = await Promise.all([
    getEbitEbitda(start, end),
    getProfitAndLoss(start, end),
    getTreatmentProfitabilityReportForPeriod(start, end, periodLabel),
  ]);

  const revenue = ebitEbitda.revenue;
  const grossProfit = ebitEbitda.grossProfit;
  const netProfit = profitAndLoss.netProfit;

  const treatments = treatmentReport.rows.map(toMarkupRow);

  const withCost = treatments.filter((t) => t.directCost != null);
  const performedWithCost = withCost.filter((t) => t.performedCount > 0);

  const mostProfitable = performedWithCost
    .filter((t): t is TreatmentMarkupRow & { periodGrossProfit: number } => t.periodGrossProfit != null)
    .sort((a, b) => b.periodGrossProfit - a.periodGrossProfit)
    .slice(0, RANKING_SIZE);

  const withMargin = withCost.filter(
    (t): t is TreatmentMarkupRow & { marginPercent: number } => t.marginPercent != null
  );

  const highestMargin = [...withMargin].sort((a, b) => b.marginPercent - a.marginPercent).slice(0, RANKING_SIZE);
  const lowestMargin = [...withMargin].sort((a, b) => a.marginPercent - b.marginPercent).slice(0, RANKING_SIZE);

  const highestMarkup = withCost
    .filter((t): t is TreatmentMarkupRow & { markupPercent: number } => t.markupPercent != null)
    .sort((a, b) => b.markupPercent - a.markupPercent)
    .slice(0, RANKING_SIZE);

  return {
    start: ebitEbitda.start,
    end: ebitEbitda.end,
    periodLabel,

    revenue,
    grossProfit,
    grossMarginPercent: percentOrNull(grossProfit, revenue),

    ebit: ebitEbitda.ebit,
    ebitMarginPercent: ebitEbitda.ebitMarginPercent,

    ebitdaAvailable: ebitEbitda.ebitdaAvailable,
    ebitda: ebitEbitda.ebitda,
    ebitdaMarginPercent: ebitEbitda.ebitdaMarginPercent,

    netProfit,
    netProfitMarginPercent: percentOrNull(netProfit, revenue),

    treatments,

    mostProfitable,
    highestMargin,
    highestMarkup,
    lowestMargin,
  };
}
