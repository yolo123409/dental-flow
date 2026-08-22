import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "@/services/clinic";
import { assertPermission } from "@/services/authorization";

import { getDateRange } from "./dateRange";

import { RevenueAnalytics } from "./types";

export async function getRevenueAnalytics(
  range: string
): Promise<RevenueAnalytics> {
  await assertPermission("analytics");

  const { start, end } = getDateRange(range);

  return getRevenueAnalyticsForPeriod(start, end);
}

/**
 * Date-parameterized core, extracted so a Custom Range (an explicit
 * start/end the Reports Center's date picker produces, which has no
 * corresponding named-range string for getDateRange to resolve) can reuse
 * the exact same revenue calculation as every named range - there is
 * still exactly one place "revenue" is computed, just two entry points
 * into it. getRevenueAnalytics(range) above is unchanged for every
 * existing caller.
 */
export async function getRevenueAnalyticsForPeriod(
  start: Date | null,
  end: Date | null,
  overrideClinicId?: string
): Promise<RevenueAnalytics> {
  const clinicId = overrideClinicId ?? (await getCurrentClinicId());

  // Revenue/tax/outstanding totals come from a SQL aggregate RPC
  // (migration 0067), not a `.select('total, tax')`/`.select('total,
  // amount_paid')` fetch of every invoice row summed in JS - that shape
  // silently truncates at PostgREST's default 1,000-row cap once a
  // clinic has enough invoices in the period (the same failure class
  // fixed for the org-wide equivalent, getRevenueTotalsByClinic, in
  // migration 0065 - this single-clinic version was never carried over
  // when that fix landed). The three count queries below already use
  // `count: 'exact', head: true`, which PostgREST computes server-side
  // regardless of how many rows would otherwise be returned - not
  // affected by this bug, left as-is.
  const analyticsQuery = supabase.rpc("get_revenue_analytics", {
    p_clinic_id: clinicId,
    p_start: start ? start.toISOString() : null,
    p_end: end ? end.toISOString() : null,
  });

  let paidInvoicesQuery = supabase
    .from("clinic_invoices")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .eq("status", "Paid");

  let unpaidInvoicesQuery = supabase
    .from("clinic_invoices")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .neq("status", "Paid");

  let totalInvoicesQuery = supabase
    .from("clinic_invoices")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId);

  if (start && end) {
    const from = start.toISOString();
    const to = end.toISOString();

    paidInvoicesQuery = paidInvoicesQuery
      .gte("created_at", from)
      .lte("created_at", to);

    unpaidInvoicesQuery = unpaidInvoicesQuery
      .gte("created_at", from)
      .lte("created_at", to);

    totalInvoicesQuery = totalInvoicesQuery
      .gte("created_at", from)
      .lte("created_at", to);
  }

  const [
    analytics,
    paidInvoices,
    unpaidInvoices,
    totalInvoices,
  ] = await Promise.all([
    analyticsQuery,
    paidInvoicesQuery,
    unpaidInvoicesQuery,
    totalInvoicesQuery,
  ]);

  const firstError = [
    analytics,
    paidInvoices,
    unpaidInvoices,
    totalInvoices,
  ].find((result) => result.error)?.error;

  if (firstError) {
    logError(
      "[analytics] getRevenueAnalytics query failed:",
      firstError
    );

    throw toError(firstError);
  }

  const analyticsRow = (analytics.data?.[0] ?? {
    total_revenue: 0,
    total_tax: 0,
    outstanding_amount: 0,
  }) as { total_revenue: number; total_tax: number; outstanding_amount: number };

  const totalRevenue = Number(analyticsRow.total_revenue ?? 0);
  const totalTaxCollected = Number(analyticsRow.total_tax ?? 0);

  return {
    totalRevenue,

    // Same total-minus-paid formula as services/billing.ts's
    // calculateBalance (the per-patient billing summary), computed
    // server-side in the same RPC now instead of client-side.
    outstandingBalance: Number(analyticsRow.outstanding_amount ?? 0),

    totalInvoices:
      totalInvoices.count ?? 0,

    paidInvoices:
      paidInvoices.count ?? 0,

    unpaidInvoices:
      unpaidInvoices.count ?? 0,

    totalTaxCollected,

    revenueExcludingTax:
      totalRevenue - totalTaxCollected,
  };
}

/**
 * Batched sibling of getRevenueAnalyticsForPeriod for organization-wide
 * aggregation (services/organizations.ts#getOrganizationFinancials),
 * which previously called getRevenueAnalyticsForPeriod once PER BRANCH
 * (5 queries x N branches - ~250 requests at 50 branches, found during a
 * production-hardening audit to be a major contributor to that page
 * timing out at scale). Deliberately narrower than the full
 * RevenueAnalytics shape - the org-financials caller only ever reads
 * `totalRevenue` per branch, so this fetches only Paid-invoice totals
 * with a single `.in('clinic_id', ...)` query instead of replicating all
 * 5 of the original function's per-branch queries. The single-clinic
 * getRevenueAnalyticsForPeriod/getRevenueAnalytics above are untouched -
 * every existing single-clinic caller (Dashboard, Analytics, Reports
 * Center) keeps using them exactly as before.
 */
export async function getRevenueTotalsByClinic(
  start: Date | null,
  end: Date | null,
  clinicIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();

  if (clinicIds.length === 0) {
    return totals;
  }

  // Aggregate RPC (migration 0065), not a `.select('clinic_id, total')`
  // fetch of every Paid invoice row - that shape was found during the
  // Part 2 50-branch scale test to silently truncate at PostgREST's
  // default 1,000-row response cap once total Paid invoices across all
  // branches crossed that number, under-reporting consolidated revenue
  // with no error. This RPC returns one row PER BRANCH, never per
  // invoice, so it can't hit that cap at any realistic organization size.
  const { data, error } = await supabase.rpc("get_organization_revenue_by_clinic", {
    p_clinic_ids: clinicIds,
    p_start: start ? start.toISOString() : null,
    p_end: end ? end.toISOString() : null,
  });

  if (error) {
    logError("[analytics] getRevenueTotalsByClinic failed:", error);
    throw toError(error);
  }

  for (const row of data ?? []) {
    totals.set(row.clinic_id, Number(row.total ?? 0));
  }

  return totals;
}