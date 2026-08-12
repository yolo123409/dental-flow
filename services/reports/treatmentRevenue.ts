import { getTreatmentProfitabilityReportForPeriod } from "@/services/treatmentProfitability";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

/**
 * Reuses Treatment Profitability's own actual-revenue aggregation
 * (matched from Paid invoice line items by treatment name, exactly like
 * that page) rather than catalog default_price - this is historical
 * revenue actually collected, not a price list.
 */
export async function generateTreatmentRevenueReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const [clinicMeta, report] = await Promise.all([
    getClinicMeta(),
    getTreatmentProfitabilityReportForPeriod(period.start, period.end, period.label),
  ]);

  let performed = report.rows.filter((row) => row.performedCount > 0);

  if (filters.treatmentId) {
    performed = performed.filter((row) => row.id === filters.treatmentId);
  }

  const totalRevenue = performed.reduce((sum, row) => sum + row.revenue, 0);

  const rows = performed
    .sort((a, b) => b.revenue - a.revenue)
    .map((row) => ({
      treatment: row.name,
      performed: row.performedCount,
      revenue: row.revenue,
      averageRevenue: row.averageSellingPrice ?? 0,
      percentOfTotal: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
    }));

  return {
    id: "treatment-revenue",
    title: "Treatment Revenue Report",
    category: "Performance",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Total Revenue", value: currencyValue(totalRevenue, clinicMeta.currency) },
      { label: "Treatments Performed", value: String(performed.length) },
      {
        label: "Top Treatment",
        value: rows[0]?.treatment ?? "—",
        subtitle: rows[0] ? currencyValue(rows[0].revenue, clinicMeta.currency) : undefined,
      },
    ],

    columns: [
      { key: "treatment", label: "Treatment", format: "text" },
      { key: "performed", label: "Number Performed", format: "number" },
      { key: "revenue", label: "Revenue", format: "currency" },
      { key: "averageRevenue", label: "Average Revenue", format: "currency" },
      { key: "percentOfTotal", label: "% of Total Revenue", format: "percent" },
    ],
    rows,
    totalsRow: { treatment: "Total", revenue: totalRevenue, percentOfTotal: 100 },

    notices: [
      {
        tone: "info",
        message:
          "Rows are catalog treatments matched to paid invoice line items by name. An invoice line whose text doesn't match any catalog treatment isn't attributable to a specific treatment and is excluded.",
      },
    ],
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
