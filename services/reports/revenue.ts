import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getRevenueAnalyticsForPeriod } from "@/services/analytics/revenue";
import { getTreatmentProfitabilityReportForPeriod } from "@/services/treatmentProfitability";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface InvoiceRow {
  created_at: string;
  total: number;
  payment_method: string | null;
}

/**
 * Total Revenue / Paid Invoices / Average Invoice all come straight from
 * getRevenueAnalyticsForPeriod - the exact same calculation the Dashboard
 * already uses - so this report can never disagree with it (section 25).
 * The three breakdowns below (by day, by treatment, by payment method)
 * are all derived from that same "Paid invoices in range" definition of
 * revenue, not a separate query with its own status filter.
 */
export async function generateRevenueReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const [clinicMeta, analytics] = await Promise.all([
    getClinicMeta(),
    getRevenueAnalyticsForPeriod(period.start, period.end),
  ]);

  let invoiceQuery = supabase
    .from("clinic_invoices")
    .select("created_at, total, payment_method")
    .eq("clinic_id", clinicMeta.clinicId)
    .eq("status", "Paid");

  if (period.start && period.end) {
    invoiceQuery = invoiceQuery
      .gte("created_at", period.start.toISOString())
      .lte("created_at", period.end.toISOString());
  }

  if (filters.paymentMethod) {
    invoiceQuery = invoiceQuery.eq("payment_method", filters.paymentMethod);
  }

  const [{ data: invoiceRows, error }, treatmentReport] = await Promise.all([
    invoiceQuery,
    getTreatmentProfitabilityReportForPeriod(period.start, period.end, period.label),
  ]);

  if (error) {
    logError("[reports] generateRevenueReport failed:", error);
    throw toError(error);
  }

  const rows = (invoiceRows ?? []) as InvoiceRow[];

  const filteredTotal = rows.reduce((sum, row) => sum + Number(row.total), 0);
  const filteredCount = rows.length;

  // Only apply the paymentMethod filter's effect to displayed figures -
  // Total Revenue on the summary card always matches the unfiltered
  // dashboard definition unless a filter narrowed the query itself.
  const usingFilter = Boolean(filters.paymentMethod);
  const totalRevenue = usingFilter ? filteredTotal : analytics.totalRevenue;
  const paidInvoices = usingFilter ? filteredCount : analytics.paidInvoices;
  const averageInvoice = paidInvoices > 0 ? totalRevenue / paidInvoices : 0;

  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(row.total));
  }

  const byMethod = new Map<string, number>();
  for (const row of rows) {
    const method = row.payment_method ?? "Unspecified";
    byMethod.set(method, (byMethod.get(method) ?? 0) + Number(row.total));
  }

  return {
    id: "revenue",
    title: "Revenue Report",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Total Revenue", value: currencyValue(totalRevenue, clinicMeta.currency) },
      { label: "Paid Invoices", value: String(paidInvoices) },
      {
        label: "Average Invoice",
        value: currencyValue(averageInvoice, clinicMeta.currency),
      },
    ],

    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "revenue", label: "Revenue", format: "currency" },
    ],
    rows: Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue })),
    totalsRow: { date: "Total", revenue: totalRevenue },

    sections: [
      {
        title: "Revenue by Treatment",
        columns: [
          { key: "treatment", label: "Treatment", format: "text" },
          { key: "performed", label: "Performed", format: "number" },
          { key: "revenue", label: "Revenue", format: "currency" },
        ],
        rows: treatmentReport.rows
          .filter((row) => row.performedCount > 0)
          .sort((a, b) => b.revenue - a.revenue)
          .map((row) => ({
            treatment: row.name,
            performed: row.performedCount,
            revenue: row.revenue,
          })),
      },
      {
        title: "Revenue by Payment Method",
        columns: [
          { key: "method", label: "Payment Method", format: "text" },
          { key: "revenue", label: "Revenue", format: "currency" },
        ],
        rows: Array.from(byMethod.entries())
          .sort(([, a], [, b]) => b - a)
          .map(([method, revenue]) => ({ method, revenue })),
      },
    ],

    notices: usingFilter
      ? [
          {
            tone: "info",
            message:
              "Totals above reflect the Payment Method filter. Clear the filter to see clinic-wide revenue matching the Dashboard.",
          },
        ]
      : [],
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
