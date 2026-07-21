import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "@/services/clinic";
import { calculateBalance } from "@/services/billing";

import { getDateRange } from "./dateRange";

import { RevenueAnalytics } from "./types";

export async function getRevenueAnalytics(
  range: string
): Promise<RevenueAnalytics> {
  const clinicId = await getCurrentClinicId();

  const { start, end } = getDateRange(range);

  let revenueQuery = supabase
    .from("clinic_invoices")
    .select("total")
    .eq("clinic_id", clinicId)
    .eq("status", "Paid");

  let outstandingQuery = supabase
    .from("clinic_invoices")
    .select("total, amount_paid")
    .eq("clinic_id", clinicId)
    .neq("status", "Paid");

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

    revenueQuery = revenueQuery
      .gte("created_at", from)
      .lte("created_at", to);

    outstandingQuery = outstandingQuery
      .gte("created_at", from)
      .lte("created_at", to);

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
    revenue,
    outstanding,
    paidInvoices,
    unpaidInvoices,
    totalInvoices,
  ] = await Promise.all([
    revenueQuery,
    outstandingQuery,
    paidInvoicesQuery,
    unpaidInvoicesQuery,
    totalInvoicesQuery,
  ]);

  const firstError = [
    revenue,
    outstanding,
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

  return {
    totalRevenue:
      revenue.data?.reduce(
        (sum, invoice) =>
          sum + Number(invoice.total ?? 0),
        0
      ) ?? 0,

    // Uses the same total-minus-paid formula as services/billing.ts's
    // calculateBalance (the per-patient billing summary) - summing full
    // `total` for unpaid invoices would double-count anything partially
    // paid, since it ignores amount_paid already collected on those rows.
    outstandingBalance: calculateBalance(
      outstanding.data ?? []
    ).outstanding,

    totalInvoices:
      totalInvoices.count ?? 0,

    paidInvoices:
      paidInvoices.count ?? 0,

    unpaidInvoices:
      unpaidInvoices.count ?? 0,
  };
}