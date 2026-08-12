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
  money_out: number;
  // NULL = no monthly break-even target configured for this branch - never
  // treated as 0, same rule as the single-branch Financial Targets feature.
  break_even_target: number | null;
  inventory_value: number;
  dentist_count: number;
  new_patient_count: number;
}

export interface OrganizationRevenueTrendPoint {
  bucket: string;
  revenue: number;
}

export interface OrganizationExpenseTrendPoint {
  bucket: string;
  total: number;
}

export interface OrganizationExpenseBreakdown {
  category_name: string;
  total: number;
}

export interface OrganizationAppointmentBreakdown {
  clinic_id: string;
  clinic_name: string;
  today_count: number;
  upcoming_count: number;
  completed_count: number;
  cancelled_count: number;
}

export interface OrganizationLowStockItem {
  clinic_id: string;
  clinic_name: string;
  item_id: string;
  item_name: string;
  quantity: number;
  minimum_stock_level: number;
}

export interface OrganizationHighestValueItem {
  clinic_id: string;
  clinic_name: string;
  item_id: string;
  item_name: string;
  quantity: number;
  cost_per_unit: number;
  value: number;
}

export interface OrganizationGrnReceipt {
  movement_id: string;
  clinic_id: string;
  clinic_name: string;
  item_name: string;
  quantity_change: number;
  supplier_name: string | null;
  grn_number: string | null;
  created_at: string;
}

export interface OrganizationRecentPurchaseOrder {
  po_id: string;
  po_number: string;
  clinic_id: string;
  clinic_name: string;
  supplier_name: string | null;
  status: string;
  total: number;
  created_at: string;
}

export interface OrganizationSupplierSpend {
  supplier_id: string;
  supplier_name: string;
  total: number;
}

export type OrganizationActivitySourceType =
  | "patient"
  | "appointment"
  | "invoice"
  | "grn"
  | "purchase_order"
  | "expense";

export interface OrganizationActivityItem {
  source_type: OrganizationActivitySourceType;
  source_id: string;
  clinic_id: string;
  clinic_name: string;
  label: string;
  occurred_at: string;
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

/**
 * One row per expense category, summed across the caller's authorized
 * branches - the org-wide "Largest Expense Category" widget is just the
 * first row of this (already sorted by total desc). "Highest Spending
 * Branch" needs no separate call - it's max(money_out) over
 * getOrganizationBranchPerformance's rows, computed where it's used.
 */
export async function getOrganizationExpenseBreakdown(
  organizationId: string,
  range: string
): Promise<OrganizationExpenseBreakdown[]> {
  const { start, end } = getDateRange(range);

  const { data, error } = await supabase.rpc(
    "get_organization_expense_breakdown",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationExpenseBreakdown failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationExpenseBreakdown[];
}

/**
 * Org-wide Money Out over time, same bucketing convention as
 * getOrganizationRevenueTrend - Net Position trend is not a separate
 * call, it's this series merged with the revenue trend by bucket,
 * computed where it's rendered (same revenue-minus-moneyOut formula
 * NetPositionWidget already uses).
 */
export async function getOrganizationExpenseTrend(
  organizationId: string,
  range: string
): Promise<OrganizationExpenseTrendPoint[]> {
  const { start, end } = getDateRange(range);
  const granularity = granularityFor(range);

  const { data, error } = await supabase.rpc(
    "get_organization_expense_trend",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
      p_granularity: granularity,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationExpenseTrend failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationExpenseTrendPoint[];
}

export async function getOrganizationAppointmentBreakdown(
  organizationId: string,
  range: string
): Promise<OrganizationAppointmentBreakdown[]> {
  const { start, end } = getDateRange(range);

  const { data, error } = await supabase.rpc(
    "get_organization_appointment_breakdown",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationAppointmentBreakdown failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationAppointmentBreakdown[];
}

export async function getOrganizationLowStockItems(
  organizationId: string,
  limit = 8
): Promise<OrganizationLowStockItem[]> {
  const { data, error } = await supabase.rpc(
    "get_organization_low_stock_items",
    { p_organization_id: organizationId, p_limit: limit }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationLowStockItems failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationLowStockItem[];
}

export async function getOrganizationHighestValueInventory(
  organizationId: string,
  limit = 8
): Promise<OrganizationHighestValueItem[]> {
  const { data, error } = await supabase.rpc(
    "get_organization_highest_value_inventory",
    { p_organization_id: organizationId, p_limit: limit }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationHighestValueInventory failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationHighestValueItem[];
}

/**
 * Doubles as "Recently Received Stock" (Inventory widget) and "Recent
 * Deliveries" (Procurement widget) - one RPC, one call site each, same
 * underlying data.
 */
export async function getOrganizationRecentGrnReceipts(
  organizationId: string,
  limit = 8
): Promise<OrganizationGrnReceipt[]> {
  const { data, error } = await supabase.rpc(
    "get_organization_recent_grn_receipts",
    { p_organization_id: organizationId, p_limit: limit }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationRecentGrnReceipts failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationGrnReceipt[];
}

export async function getOrganizationRecentPurchaseOrders(
  organizationId: string,
  limit = 8
): Promise<OrganizationRecentPurchaseOrder[]> {
  const { data, error } = await supabase.rpc(
    "get_organization_recent_purchase_orders",
    { p_organization_id: organizationId, p_limit: limit }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationRecentPurchaseOrders failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationRecentPurchaseOrder[];
}

/**
 * "Top Suppliers" - computed from GRN-received cost*quantity on Received
 * GRNs, not PO totals (a PO can be partially fulfilled; only a GRN
 * represents what was actually delivered/billed - same authoritative
 * source confirm_grn_receipt already uses for "Latest Cost").
 */
export async function getOrganizationSupplierSpend(
  organizationId: string,
  range: string,
  limit = 8
): Promise<OrganizationSupplierSpend[]> {
  const { start, end } = getDateRange(range);

  const { data, error } = await supabase.rpc(
    "get_organization_supplier_spend",
    {
      p_organization_id: organizationId,
      p_start: start ? start.toISOString() : null,
      p_end: end ? end.toISOString() : null,
      p_limit: limit,
    }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationSupplierSpend failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationSupplierSpend[];
}

/**
 * One UNION ALL round trip across patients/appointments/invoices/GRNs/
 * POs/expenses instead of six separate queries.
 */
export async function getOrganizationRecentActivity(
  organizationId: string,
  limit = 15
): Promise<OrganizationActivityItem[]> {
  const { data, error } = await supabase.rpc(
    "get_organization_recent_activity",
    { p_organization_id: organizationId, p_limit: limit }
  );

  if (error) {
    logError(
      "[organizationAnalytics] getOrganizationRecentActivity failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationActivityItem[];
}
