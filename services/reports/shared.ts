import { getCurrentClinicId } from "@/services/clinic";
import { getClinicSettings } from "@/services/settings";
import { getProfitAndLoss } from "@/services/ledger";

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

// "Since the beginning" lower bound for a null start - this app has no
// data before the Unix epoch, so this is equivalent to "no lower bound"
// for getProfitAndLoss(), which (unlike this function) requires concrete
// Date arguments rather than accepting null.
const UNBOUNDED_START = new Date(0);

export interface PeriodFinancials {
  revenue: number;
  directCosts: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
}

/**
 * FIN-1: the canonical per-period financial summary shared by the Reports
 * Center's Profit & Loss and Monthly Comparison reports (and, until
 * FIN-1, by the Ledger Dashboard - see services/ledger.ts#getLedgerDashboardTotals,
 * which now calls getProfitAndLoss() directly instead of this function).
 *
 * Every figure is read verbatim from the general ledger's own accrual
 * Profit & Loss (getProfitAndLoss(), services/ledger.ts) - never
 * recomputed from clinic_invoices/clinic_expenses/clinic_treatments
 * directly. This is a thin adapter, not a second accounting engine: it
 * exists only so callers written against this shape don't each need their
 * own Date-normalization/field-mapping boilerplate over getProfitAndLoss().
 *
 * Before FIN-1 this function computed each figure independently -
 * SUM(clinic_invoices.total) WHERE status = 'Paid' for revenue,
 * clinic_treatments.direct_cost x performed-count for direct costs, and
 * SUM(clinic_expenses.amount) WHERE status = 'Paid' for expenses. That
 * produced a second, incompatible "Profit & Loss" alongside the ledger's
 * real one, on a different accounting basis (a "Paid invoices" revenue
 * definition is neither cash nor accrual) - see the FIN-0 audit, finding
 * P1-1. Every caller now shares the exact same ledger-derived figures a
 * ledger P&L page would show for the same period, so two reports can never
 * again disagree about what "Revenue" or "Net Profit" means for the same
 * dates.
 *
 * Treatment Profitability's own cost-coverage metric (what % of revenue
 * comes from treatments with a manually-configured clinic_treatments.direct_cost)
 * has no ledger equivalent and is NOT part of this function - it remains
 * exclusively on the Treatment Profitability report
 * (getTreatmentProfitabilityReportForPeriod), which callers needing it
 * should call directly rather than through this financial summary.
 */
export async function getPeriodFinancials(
  start: Date | null,
  end: Date | null,
  overrideClinicId?: string
): Promise<PeriodFinancials> {
  const periodStart = start ?? UNBOUNDED_START;
  const periodEnd = end ?? new Date();

  const pl = await getProfitAndLoss(periodStart, periodEnd, overrideClinicId);

  return {
    revenue: pl.revenue.total,
    directCosts: pl.directCosts.total,
    expenses: pl.totalOperatingExpenses,
    grossProfit: pl.grossProfit,
    netProfit: pl.netProfit,
  };
}
