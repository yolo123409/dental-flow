import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getDateRange } from "./analytics/dateRange";
import { granularityFor } from "./analytics/charts";

export interface OrganizationBranchPerformance {
  clinic_id: string;
  clinic_name: string;
  revenue: number;
  outstanding_balance: number;
  patient_count: number;
  appointment_count: number;
  invoice_count: number;
}

export interface OrganizationRevenueTrendPoint {
  bucket: string;
  revenue: number;
}

/**
 * One row per branch the caller is authorized to see (per their
 * branch_access), with revenue/outstanding/patient/appointment/invoice
 * totals for the given date range - server-aggregated (never raw
 * patient/appointment rows), so it's safe for a Viewer, who has no
 * clinic_users row anywhere and therefore no other way to read clinic
 * data at all. Org-wide KPI totals are just a client-side sum over this
 * already-small (<= branch count) array.
 */
export async function getOrganizationBranchPerformance(
  organizationId: string,
  range: string
): Promise<OrganizationBranchPerformance[]> {
  const { start, end } = getDateRange(range);

  const { data, error } = await supabase.rpc(
    "get_organization_branch_performance",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationBranchPerformance failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationBranchPerformance[];
}

/**
 * Org-wide revenue over time across the caller's authorized branches,
 * bucketed in SQL (not fetched raw and bucketed client-side like the
 * single-clinic getRevenueChartData) - org-wide across 100+ branches can
 * mean far more raw invoice rows than one clinic's chart ever fetches.
 */
export async function getOrganizationRevenueTrend(
  organizationId: string,
  range: string
): Promise<OrganizationRevenueTrendPoint[]> {
  const { start, end } = getDateRange(range);
  const granularity = granularityFor(range);

  const { data, error } = await supabase.rpc(
    "get_organization_revenue_trend",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
      p_granularity: granularity,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationRevenueTrend failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationRevenueTrendPoint[];
}
