import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getDateRange } from "./analytics/dateRange";
import { assertPermission } from "./authorization";

import {
  TreatmentProfitabilityReport,
  TreatmentProfitabilityRow,
  TreatmentProfitabilitySummary,
} from "@/types/treatmentProfitability";

function normalizeTreatmentName(name: string): string {
  return name.trim().toLowerCase();
}

interface TreatmentCatalogRow {
  id: string;
  name: string;
  category: string;
  default_price: number;
  direct_cost: number | null;
}

interface TreatmentCatalogRowMulti extends TreatmentCatalogRow {
  clinic_id: string;
}

interface TreatmentActual {
  performedCount: number;
  revenue: number;
}

interface RawTreatmentActualRow {
  clinic_id: string;
  treatment_name_normalized: string;
  performed_count: number;
  revenue: number;
}

/**
 * Pure: given one clinic's treatment catalog and its already-aggregated
 * actuals (performed count / revenue per normalized treatment name),
 * builds the full report. Extracted so the batched multi-clinic path
 * (getTreatmentProfitabilityForClinics, used by the CEO Consolidated
 * Financials page) and the single-clinic path
 * (getTreatmentProfitabilityReportForPeriod) share this one computation -
 * only how `actuals` gets populated differs between them (a SQL
 * aggregate RPC either way, single- vs. multi-clinic - see the module
 * doc comment on getTreatmentProfitabilityReportForPeriod).
 */
function buildTreatmentProfitabilityReport(
  treatments: TreatmentCatalogRow[],
  actuals: Map<string, TreatmentActual>,
  rangeLabel: string
): TreatmentProfitabilityReport {
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
  rangeLabel: string,
  overrideClinicId?: string
): Promise<TreatmentProfitabilityReport> {
  await assertPermission("treatment_profitability");

  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

  // Actuals (performed count/revenue per treatment name) come from a SQL
  // aggregate RPC (migration 0066), not a `.select(...clinic_invoice_items...)`
  // fetch of every Paid invoice with its line items - that shape returns
  // one row per invoice and silently truncates at PostgREST's default
  // 1,000-row cap once a clinic has enough Paid invoices in the period
  // (the same failure class found and fixed for the org-wide revenue/
  // expense/patient queries in migration 0065). get_treatment_actuals_multi
  // returns at most one row per distinct treatment name actually billed,
  // bounded by catalog size rather than invoice volume - see its own
  // migration comment for the full reasoning.
  const [treatmentsResult, actualsResult] = await Promise.all([
    supabase
      .from("clinic_treatments")
      .select("id, name, category, default_price, direct_cost")
      .eq("clinic_id", clinicId)
      .order("category")
      .order("name"),
    supabase.rpc("get_treatment_actuals_multi", {
      p_clinic_ids: [clinicId],
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
    }),
  ]);

  if (treatmentsResult.error) {
    logError(
      "[treatmentProfitability] load treatments failed:",
      treatmentsResult.error
    );

    throw toError(treatmentsResult.error);
  }

  if (actualsResult.error) {
    logError(
      "[treatmentProfitability] load actuals failed:",
      actualsResult.error
    );

    throw toError(actualsResult.error);
  }

  const actuals = new Map<string, TreatmentActual>(
    ((actualsResult.data ?? []) as RawTreatmentActualRow[]).map((row) => [
      row.treatment_name_normalized,
      {
        performedCount: Number(row.performed_count),
        revenue: Number(row.revenue),
      },
    ])
  );

  const treatments = (treatmentsResult.data ?? []) as TreatmentCatalogRow[];

  return buildTreatmentProfitabilityReport(treatments, actuals, rangeLabel);
}

/**
 * Batched form of getTreatmentProfitabilityReportForPeriod for every
 * branch of an organization at once - one catalog query (safely paged
 * via fetchAllRows, since 50 branches' worth of catalogs can plausibly
 * cross the 1,000-row cap even though a single branch's never would) and
 * one aggregate RPC call, regardless of branch count. Used by the CEO
 * Consolidated Financials page.
 */
export async function getTreatmentProfitabilityForClinics(
  clinicIds: string[],
  start: Date | null,
  end: Date | null,
  rangeLabel: string
): Promise<Map<string, TreatmentProfitabilityReport>> {
  await assertPermission("treatment_profitability");

  const results = new Map<string, TreatmentProfitabilityReport>();

  if (clinicIds.length === 0) {
    return results;
  }

  const [treatments, actualsResult] = await Promise.all([
    fetchAllRows<TreatmentCatalogRowMulti>((from, to) =>
      supabase
        .from("clinic_treatments")
        .select("id, name, category, default_price, direct_cost, clinic_id")
        .in("clinic_id", clinicIds)
        .order("clinic_id")
        .order("category")
        .order("name")
        .range(from, to)
    ),
    supabase.rpc("get_treatment_actuals_multi", {
      p_clinic_ids: clinicIds,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
    }),
  ]);

  if (actualsResult.error) {
    logError(
      "[treatmentProfitability] getTreatmentProfitabilityForClinics failed to load actuals:",
      actualsResult.error
    );

    throw toError(actualsResult.error);
  }

  const treatmentsByClinicId = new Map<string, TreatmentCatalogRow[]>();

  for (const row of treatments) {
    const existing = treatmentsByClinicId.get(row.clinic_id) ?? [];
    existing.push(row);
    treatmentsByClinicId.set(row.clinic_id, existing);
  }

  const actualsByClinicId = new Map<string, Map<string, TreatmentActual>>();

  for (const row of (actualsResult.data ?? []) as RawTreatmentActualRow[]) {
    const clinicId = row.clinic_id;
    const existing = actualsByClinicId.get(clinicId) ?? new Map<string, TreatmentActual>();

    existing.set(row.treatment_name_normalized, {
      performedCount: Number(row.performed_count),
      revenue: Number(row.revenue),
    });

    actualsByClinicId.set(clinicId, existing);
  }

  for (const clinicId of clinicIds) {
    results.set(
      clinicId,
      buildTreatmentProfitabilityReport(
        treatmentsByClinicId.get(clinicId) ?? [],
        actualsByClinicId.get(clinicId) ?? new Map(),
        rangeLabel
      )
    );
  }

  return results;
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
  await assertPermission("treatment_profitability_manage");
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
