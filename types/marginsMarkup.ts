/**
 * Margins & Markup - clinic-level figures are read verbatim from
 * getEbitEbitda()/getProfitAndLoss() (never recomputed), so they always
 * reconcile with the P&L and EBIT/EBITDA reports for the same period.
 * Treatment-level figures reuse getTreatmentProfitabilityReportForPeriod()
 * entirely - this file only adds the one thing that service doesn't
 * compute (Markup %) on top of its existing catalog price/cost fields.
 *
 * Price/Direct Cost/Gross Profit/Margin %/Markup % are catalog-level
 * (the treatment's configured selling price and direct cost - a stable
 * per-unit definition, unaffected by how many were sold this period).
 * Number Sold and Revenue Generated are period-actual, from Paid
 * invoices in the selected range - the same figures the Treatment
 * Profitability report already shows.
 */
export interface TreatmentMarkupRow {
  id: string;
  name: string;
  category: string;

  sellingPrice: number;
  /** null = cost not recorded at all; 0 = recorded as exactly zero. Never conflated. */
  directCost: number | null;
  grossProfitPerUnit: number | null;
  /** (sellingPrice - directCost) / sellingPrice * 100. Null when directCost is unavailable. */
  marginPercent: number | null;
  /** (sellingPrice - directCost) / directCost * 100. Null when cost is unrecorded OR recorded as zero - never Infinity. */
  markupPercent: number | null;

  performedCount: number;
  revenueGenerated: number;
  /** Period-actual total gross profit (performedCount x per-unit profit) - used for the "Most Profitable" ranking, not shown as its own table column. */
  periodGrossProfit: number | null;
}

export interface MarginsMarkupReport {
  start: string;
  end: string;
  periodLabel: string;

  revenue: number;
  grossProfit: number;
  grossMarginPercent: number | null;

  ebit: number;
  ebitMarginPercent: number | null;

  ebitdaAvailable: boolean;
  ebitda: number | null;
  ebitdaMarginPercent: number | null;

  netProfit: number;
  netProfitMarginPercent: number | null;

  treatments: TreatmentMarkupRow[];

  mostProfitable: TreatmentMarkupRow[];
  highestMargin: TreatmentMarkupRow[];
  highestMarkup: TreatmentMarkupRow[];
  lowestMargin: TreatmentMarkupRow[];
}
