import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getDateRange } from "./analytics/dateRange";

import {
  TreatmentProfitabilityReport,
  TreatmentProfitabilityRow,
  TreatmentProfitabilitySummary,
} from "@/types/treatmentProfitability";

function normalizeTreatmentName(name: string): string {
  return name.trim().toLowerCase();
}

interface InvoiceItemRow {
  treatment_name: string;
  quantity: number;
  total_price: number;
}

interface PaidInvoiceRow {
  id: string;
  clinic_invoice_items: InvoiceItemRow[] | null;
}

interface TreatmentCatalogRow {
  id: string;
  name: string;
  category: string;
  default_price: number;
  direct_cost: number | null;
}

/* -------------------------------------- */
/* Get Treatment Profitability Report      */
/* -------------------------------------- */

/**
 * Revenue and performed-count come from clinic_invoice_items on Paid
 * invoices - the same "Paid invoice total" definition of revenue that
 * services/analytics/revenue.ts already uses elsewhere, so these numbers
 * stay consistent with the rest of DentalFlow's financial reporting.
 *
 * Invoice items only carry a free-text treatment_name (no treatment_id FK -
 * see services/billing.ts), so matching back to the clinic_treatments
 * catalog is done by normalized (trimmed, lowercased) name. An invoice line
 * whose text doesn't match any catalog treatment isn't attributable to a
 * specific treatment's profitability and is excluded, rather than guessed.
 */
export async function getTreatmentProfitabilityReport(
  range: string
): Promise<TreatmentProfitabilityReport> {
  const { start, end } = getDateRange(range);

  return getTreatmentProfitabilityReportForPeriod(start, end, range);
}

/**
 * Date-parameterized core, extracted so reports needing a Custom Range
 * (an explicit start/end with no corresponding named-range string) or an
 * arbitrary comparison period (e.g. Monthly Comparison's "previous
 * month") can reuse the exact same actual-revenue/direct-cost
 * calculation this page's own summary cards use, rather than a second
 * definition of treatment profitability. getTreatmentProfitabilityReport
 * (range) above is unchanged for every existing caller.
 */
export async function getTreatmentProfitabilityReportForPeriod(
  start: Date | null,
  end: Date | null,
  rangeLabel: string
): Promise<TreatmentProfitabilityReport> {
  const clinicId = await getCurrentClinicId();

  let invoicesQuery = supabase
    .from("clinic_invoices")
    .select(
      "id, clinic_invoice_items(treatment_name, quantity, total_price)"
    )
    .eq("clinic_id", clinicId)
    .eq("status", "Paid");

  if (start && end) {
    invoicesQuery = invoicesQuery
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());
  }

  const [treatmentsResult, invoicesResult] = await Promise.all([
    supabase
      .from("clinic_treatments")
      .select("id, name, category, default_price, direct_cost")
      .eq("clinic_id", clinicId)
      .order("category")
      .order("name"),
    invoicesQuery,
  ]);

  if (treatmentsResult.error) {
    logError(
      "[treatmentProfitability] load treatments failed:",
      treatmentsResult.error
    );

    throw toError(treatmentsResult.error);
  }

  if (invoicesResult.error) {
    logError(
      "[treatmentProfitability] load invoices failed:",
      invoicesResult.error
    );

    throw toError(invoicesResult.error);
  }

  const actuals = new Map<
    string,
    { performedCount: number; revenue: number }
  >();

  for (const invoice of (invoicesResult.data ?? []) as PaidInvoiceRow[]) {
    for (const item of invoice.clinic_invoice_items ?? []) {
      const key = normalizeTreatmentName(item.treatment_name ?? "");

      if (!key) continue;

      const existing = actuals.get(key) ?? {
        performedCount: 0,
        revenue: 0,
      };

      existing.performedCount += Number(item.quantity ?? 0);
      existing.revenue += Number(item.total_price ?? 0);

      actuals.set(key, existing);
    }
  }

  const treatments = (treatmentsResult.data ?? []) as TreatmentCatalogRow[];

  const rows: TreatmentProfitabilityRow[] = treatments.map((treatment) => {
    const actual = actuals.get(normalizeTreatmentName(treatment.name)) ?? {
      performedCount: 0,
      revenue: 0,
    };

    const sellingPrice = Number(treatment.default_price ?? 0);

    const directCost =
      treatment.direct_cost == null ? null : Number(treatment.direct_cost);

    const grossProfitPerUnit =
      directCost == null ? null : sellingPrice - directCost;

    const grossMarginPerUnit =
      grossProfitPerUnit == null || sellingPrice <= 0
        ? null
        : (grossProfitPerUnit / sellingPrice) * 100;

    const actualDirectCosts =
      directCost == null ? null : actual.performedCount * directCost;

    const actualGrossProfit =
      actualDirectCosts == null ? null : actual.revenue - actualDirectCosts;

    const actualGrossMargin =
      actualGrossProfit == null || actual.revenue <= 0
        ? null
        : (actualGrossProfit / actual.revenue) * 100;

    return {
      id: treatment.id,
      name: treatment.name,
      category: treatment.category,

      sellingPrice,
      directCost,
      grossProfitPerUnit,
      grossMarginPerUnit,

      performedCount: actual.performedCount,
      revenue: actual.revenue,
      averageSellingPrice:
        actual.performedCount > 0
          ? actual.revenue / actual.performedCount
          : null,
      actualDirectCosts,
      actualGrossProfit,
      actualGrossMargin,
    };
  });

  return {
    rows,
    summary: buildSummary(rows),
    range: rangeLabel,
  };
}

function buildSummary(
  rows: TreatmentProfitabilityRow[]
): TreatmentProfitabilitySummary {
  const performedRows = rows.filter((row) => row.performedCount > 0);

  const totalRevenue = performedRows.reduce(
    (sum, row) => sum + row.revenue,
    0
  );

  const costKnownRows = performedRows.filter(
    (row) => row.directCost != null
  );

  const costConfiguredRevenue = costKnownRows.reduce(
    (sum, row) => sum + row.revenue,
    0
  );

  const totalDirectCosts = costKnownRows.reduce(
    (sum, row) => sum + (row.actualDirectCosts ?? 0),
    0
  );

  const totalGrossProfit = costConfiguredRevenue - totalDirectCosts;

  return {
    totalRevenue,
    costConfiguredRevenue,
    totalDirectCosts,
    totalGrossProfit,
    averageGrossMargin:
      costConfiguredRevenue > 0
        ? (totalGrossProfit / costConfiguredRevenue) * 100
        : null,
    treatmentsPerformedCount: performedRows.length,
    treatmentsWithCostConfigured: costKnownRows.length,
    treatmentsMissingCost: performedRows.length - costKnownRows.length,
    costCoveragePercent:
      totalRevenue > 0 ? (costConfiguredRevenue / totalRevenue) * 100 : null,
  };
}

/* -------------------------------------- */
/* Configure Direct Cost                  */
/* -------------------------------------- */

export async function updateTreatmentDirectCost(
  treatmentId: string,
  directCost: number | null
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_treatments")
    .update({
      direct_cost: directCost,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("id", treatmentId);

  if (error) {
    logError(
      "[treatmentProfitability] updateTreatmentDirectCost failed:",
      error
    );

    throw toError(error);
  }
}
