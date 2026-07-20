import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "@/services/clinic";

import { getDateRange } from "./dateRange";

import { RevenueAnalytics } from "./types";

export async function getRevenueAnalytics(
  range: string
): Promise<RevenueAnalytics> {
  const clinicId = await getCurrentClinicId();

  const { start, end } = getDateRange(range);

  let revenueQuery = supabase
    .from("clinic_invoices")
    .select("amount")
    .eq("clinic_id", clinicId)
    .eq("status", "Paid");

  let outstandingQuery = supabase
    .from("clinic_invoices")
    .select("amount")
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

  return {
    totalRevenue:
      revenue.data?.reduce(
        (sum, invoice) =>
          sum + Number(invoice.amount ?? 0),
        0
      ) ?? 0,

    outstandingBalance:
      outstanding.data?.reduce(
        (sum, invoice) =>
          sum + Number(invoice.amount ?? 0),
        0
      ) ?? 0,

    totalInvoices:
      totalInvoices.count ?? 0,

    paidInvoices:
      paidInvoices.count ?? 0,

    unpaidInvoices:
      unpaidInvoices.count ?? 0,
  };
}