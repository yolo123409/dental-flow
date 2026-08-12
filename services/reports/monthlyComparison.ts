import { supabase } from "@/lib/supabase";
import { getDateRange } from "@/services/analytics/dateRange";

import { ReportColumnFormat, ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, getPeriodFinancials } from "./shared";

interface PeriodBounds {
  start: Date | null;
  end: Date | null;
}

async function countInRange(
  table: string,
  dateColumn: string,
  clinicId: string,
  bounds: PeriodBounds
): Promise<number> {
  let query = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (bounds.start && bounds.end) {
    query = query
      .gte(dateColumn, bounds.start.toISOString())
      .lte(dateColumn, bounds.end.toISOString());
  }

  const { count } = await query;
  return count ?? 0;
}

async function paymentsCount(
  clinicId: string,
  bounds: PeriodBounds
): Promise<number> {
  let query = supabase
    .from("clinic_payments")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (bounds.start && bounds.end) {
    query = query
      .gte("received_at", bounds.start.toISOString())
      .lte("received_at", bounds.end.toISOString());
  }

  const { count } = await query;
  return count ?? 0;
}

async function metricsForPeriod(clinicId: string, bounds: PeriodBounds) {
  const [financials, patients, appointments, invoices, payments] = await Promise.all([
    getPeriodFinancials(bounds.start, bounds.end),
    countInRange("patients", "created_at", clinicId, bounds),
    countInRange("appointments", "created_at", clinicId, bounds),
    countInRange("clinic_invoices", "created_at", clinicId, bounds),
    paymentsCount(clinicId, bounds),
  ]);

  return {
    revenue: financials.revenue,
    expenses: financials.expenses,
    grossProfit: financials.grossProfit,
    netProfit: financials.netProfit,
    patients,
    appointments,
    invoices,
    payments,
  };
}

type Metrics = Awaited<ReturnType<typeof metricsForPeriod>>;

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function buildComparisonRows(
  current: Metrics,
  previous: Metrics,
  lastYear: Metrics,
  metrics: { key: keyof Metrics; label: string }[]
) {
  return metrics.map(({ key, label }) => ({
    metric: label,
    current: current[key],
    previous: previous[key],
    change: percentChange(current[key], previous[key]),
    sameMonthLastYear: lastYear[key],
  }));
}

function comparisonColumns(now: Date, valueFormat: ReportColumnFormat) {
  return [
    { key: "metric", label: "Metric", format: "text" as ReportColumnFormat },
    { key: "current", label: monthLabel(now), format: valueFormat },
    {
      key: "previous",
      label: monthLabel(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      format: valueFormat,
    },
    { key: "change", label: "Change", format: "percent" as ReportColumnFormat },
    {
      key: "sameMonthLastYear",
      label: `${monthLabel(now)} (Last Year)`,
      format: valueFormat,
    },
  ];
}

/**
 * Fixed to "this calendar month vs. last calendar month" (and the same
 * month one year ago, where that data exists) rather than the Reports
 * Center's selected date range - a month-over-month comparison only
 * makes sense against actual calendar months, matching the existing
 * services/expenses.ts#getMonthOverMonthExpenses precedent. Financial
 * (currency) and volume (count) metrics are two separate tables rather
 * than one mixed table, since a single column can only carry one display
 * format and "Revenue" and "New Patients" need different ones.
 */
export async function generateMonthlyComparisonReport(
  _period: ReportPeriod,
  _filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  const now = new Date();
  const thisMonth = getDateRange("This Month");
  const lastMonth = getDateRange("Last Month");

  const lastYearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);
  lastYearEnd.setHours(23, 59, 59, 999);

  const [current, previous, lastYear] = await Promise.all([
    metricsForPeriod(clinicMeta.clinicId, thisMonth),
    metricsForPeriod(clinicMeta.clinicId, lastMonth),
    metricsForPeriod(clinicMeta.clinicId, { start: lastYearStart, end: lastYearEnd }),
  ]);

  const financialRows = buildComparisonRows(current, previous, lastYear, [
    { key: "revenue", label: "Revenue" },
    { key: "expenses", label: "Expenses" },
    { key: "grossProfit", label: "Gross Profit" },
    { key: "netProfit", label: "Net Profit" },
  ]);

  const volumeRows = buildComparisonRows(current, previous, lastYear, [
    { key: "patients", label: "New Patients" },
    { key: "appointments", label: "Appointments" },
    { key: "invoices", label: "Invoices" },
    { key: "payments", label: "Payments" },
  ]);

  return {
    id: "monthly-comparison",
    title: "Monthly Comparison",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: `${monthLabel(now)} vs ${monthLabel(
      new Date(now.getFullYear(), now.getMonth() - 1, 1)
    )}`,
    generatedAt: new Date().toISOString(),

    summaryCards: [
      {
        label: "Revenue Change",
        value: formatChange(percentChange(current.revenue, previous.revenue)),
      },
      {
        label: "Net Profit Change",
        value: formatChange(percentChange(current.netProfit, previous.netProfit)),
      },
      {
        label: "New Patients Change",
        value: formatChange(percentChange(current.patients, previous.patients)),
      },
    ],

    columns: comparisonColumns(now, "currency"),
    rows: financialRows,

    sections: [
      {
        title: "Volume Metrics",
        columns: comparisonColumns(now, "number"),
        rows: volumeRows,
      },
    ],
  };
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatChange(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
