export interface TreatmentProfitabilityRow {
  id: string;

  name: string;

  category: string;

  // Catalog-level (clinic_treatments), not tied to any date range.
  sellingPrice: number;
  directCost: number | null;
  grossProfitPerUnit: number | null;
  grossMarginPerUnit: number | null;

  // Actual, historical performance within the selected date range - from
  // Paid clinic_invoices/clinic_invoice_items matched to this treatment by
  // name.
  performedCount: number;
  revenue: number;
  averageSellingPrice: number | null;
  actualDirectCosts: number | null;
  actualGrossProfit: number | null;
  actualGrossMargin: number | null;
}

export interface TreatmentProfitabilitySummary {
  // All actual revenue in range, regardless of whether cost is configured.
  totalRevenue: number;

  // The subset of totalRevenue that belongs to treatments with a
  // configured direct cost - the only subset gross profit/margin can be
  // computed from without guessing.
  costConfiguredRevenue: number;

  totalDirectCosts: number;
  totalGrossProfit: number;
  averageGrossMargin: number | null;

  treatmentsPerformedCount: number;
  treatmentsWithCostConfigured: number;
  treatmentsMissingCost: number;

  // costConfiguredRevenue / totalRevenue * 100 - null when there's no
  // revenue at all in range. Used to warn when gross profit figures are
  // based on only a partial slice of actual revenue.
  costCoveragePercent: number | null;
}

export interface TreatmentProfitabilityReport {
  rows: TreatmentProfitabilityRow[];
  summary: TreatmentProfitabilitySummary;
  range: string;
}
