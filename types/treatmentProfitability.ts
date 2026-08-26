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
  // name. Revenue basis limitation (FIN-2): clinic_invoice_items carries no
  // link back to a specific treatment_plan_items instance (only a
  // free-text treatment_name - see services/billing.ts#createInvoice), so
  // this remains a catalog-name-matched aggregate, not a strict
  // per-instance pairing - unchanged from before FIN-2, and not something
  // FIN-2 attempts to fix (would require a billing/invoice schema change,
  // out of scope - see services/treatmentMaterialUsage.ts's module doc).
  performedCount: number;
  revenue: number;
  averageSellingPrice: number | null;

  // ESTIMATE, scaled by volume (performedCount * directCost) - "if every
  // performed treatment cost exactly what directCost assumes". Renamed
  // from actualDirectCosts/actualGrossProfit/actualGrossMargin (FIN-2):
  // those names were applied to this same estimate-scaled figure, which
  // is not actual cost data. Null exactly when directCost itself is null
  // (cost not configured).
  estimatedDirectCosts: number | null;
  estimatedGrossProfit: number | null;
  estimatedGrossMargin: number | null;

  // ACTUAL - real inventory consumption recorded via the "Materials Used"
  // section on each performed treatment_plan_item in this period (FIN-2,
  // services/treatmentMaterialUsage.ts), summed across every instance of
  // this catalog treatment. Never null: a treatment with no materials
  // recorded has actualMaterialCost = 0, per FIN-2's explicit "do not
  // substitute the estimate" rule - it is not "unknown", it is genuinely
  // zero recorded consumption. actualGrossProfit/actualGrossMargin are
  // null only when the treatment wasn't performed at all in this period
  // (performedCount = 0, so there's no revenue to net against).
  actualMaterialCost: number;
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

  // ACTUAL (FIN-2) - real recorded material consumption, summed across
  // every performed treatment in range, regardless of whether a direct
  // cost estimate is configured (unlike the estimate-based fields above,
  // this never needs to exclude "cost not configured" rows, since 0 is
  // itself the correct, real answer for "no materials recorded").
  totalActualMaterialCost: number;
  totalActualGrossProfit: number;
  averageActualGrossMargin: number | null;
}

export interface TreatmentProfitabilityReport {
  rows: TreatmentProfitabilityRow[];
  summary: TreatmentProfitabilitySummary;
  range: string;
}
