import { getCurrentClinicId } from "@/services/clinic";
import { getClinicSettings } from "@/services/settings";
import { getExpenses } from "@/services/expenses";
import { getRevenueAnalyticsForPeriod } from "@/services/analytics/revenue";
import { getTreatmentProfitabilityReportForPeriod } from "@/services/treatmentProfitability";

import { ReportPeriod } from "@/types/reports";
import { formatDateRangeLabel } from "@/lib/reports/format";

export interface ClinicMeta {
  clinicId: string;
  clinicName: string;
  currency: string;
}

export async function getClinicMeta(): Promise<ClinicMeta> {
  const [clinicId, settings] = await Promise.all([
    getCurrentClinicId(),
    getClinicSettings(),
  ]);

  return {
    clinicId,
    clinicName: settings.clinic_name || "DentalFlow Clinic",
    currency: settings.currency || "KES",
  };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function periodLabel(period: ReportPeriod): string {
  return formatDateRangeLabel(period.label, period.start, period.end);
}

async function getExpensesForPeriod(start: Date | null, end: Date | null) {
  if (!start || !end) {
    return getExpenses({});
  }

  return getExpenses({
    dateRange: "Custom",
    customStart: isoDate(start),
    customEnd: isoDate(end),
  });
}

export interface PeriodFinancials {
  revenue: number;
  directCosts: number;
  costCoveragePercent: number | null;
  expenses: number;
  grossProfit: number;
  netProfit: number;
}

/**
 * Shared by the Profit & Loss and Monthly Comparison reports - both need
 * "revenue minus known direct treatment costs minus operating expenses"
 * for one or more periods, and this is the one place that math lives so
 * the two reports can never silently drift apart on the same formula.
 * Revenue and direct-cost figures are pulled from the exact same
 * calculations the Dashboard and Treatment Profitability pages already
 * use (getRevenueAnalyticsForPeriod / getTreatmentProfitabilityReportForPeriod).
 */
export async function getPeriodFinancials(
  start: Date | null,
  end: Date | null
): Promise<PeriodFinancials> {
  const [revenueAnalytics, profitabilityReport, expenses] = await Promise.all([
    getRevenueAnalyticsForPeriod(start, end),
    getTreatmentProfitabilityReportForPeriod(start, end, "period"),
    getExpensesForPeriod(start, end),
  ]);

  const revenue = revenueAnalytics.totalRevenue;
  const directCosts = profitabilityReport.summary.totalDirectCosts;

  const paidExpenses = expenses
    .filter((expense) => expense.status === "Paid")
    .reduce((sum, expense) => sum + Number(expense.amount), 0);

  const grossProfit = revenue - directCosts;
  const netProfit = grossProfit - paidExpenses;

  return {
    revenue,
    directCosts,
    costCoveragePercent: profitabilityReport.summary.costCoveragePercent,
    expenses: paidExpenses,
    grossProfit,
    netProfit,
  };
}
