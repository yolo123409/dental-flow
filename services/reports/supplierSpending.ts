import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface GrnRow {
  id: string;
  supplier_id: string;
  clinic_suppliers: { name: string } | null;
  clinic_grn_items: { quantity_received: number; unit_cost: number }[];
}

/**
 * Authoritative purchasing source, determined before writing this (see
 * migration 0025/0027 read during the Inventory Stock Control round):
 * Purchase Orders represent intent/what was ordered and never post to
 * inventory or cost anything by themselves; a GRN with status='Received'
 * is what actually posted stock and cost into the clinic (via
 * confirm_grn_receipt). Using Received GRNs here - not Purchase full
 * order totals - avoids double-counting a PO's total and its GRN's total
 * for the same physical delivery, and matches what actually happened.
 */
export async function generateSupplierSpendingReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  let query = supabase
    .from("clinic_goods_received_notes")
    .select(
      "id, supplier_id, clinic_suppliers(name), clinic_grn_items(quantity_received, unit_cost)"
    )
    .eq("clinic_id", clinicMeta.clinicId)
    .eq("status", "Received");

  if (period.start && period.end) {
    query = query
      .gte("received_at", period.start.toISOString())
      .lte("received_at", period.end.toISOString());
  }

  if (filters.supplierId) {
    query = query.eq("supplier_id", filters.supplierId);
  }

  const { data, error } = await query;

  if (error) {
    logError("[reports] generateSupplierSpendingReport failed:", error);
    throw toError(error);
  }

  const grns = (data ?? []) as unknown as GrnRow[];

  const bySupplier = new Map<
    string,
    { name: string; total: number; grnCount: number }
  >();

  for (const grn of grns) {
    const total = grn.clinic_grn_items.reduce(
      (sum, item) => sum + Number(item.quantity_received) * Number(item.unit_cost),
      0
    );

    const existing = bySupplier.get(grn.supplier_id) ?? {
      name: grn.clinic_suppliers?.name ?? "Unknown Supplier",
      total: 0,
      grnCount: 0,
    };

    existing.total += total;
    existing.grnCount += 1;

    bySupplier.set(grn.supplier_id, existing);
  }

  const rows = Array.from(bySupplier.values())
    .sort((a, b) => b.total - a.total)
    .map((entry) => ({
      supplier: entry.name,
      totalPurchases: entry.total,
      grnCount: entry.grnCount,
      averagePurchase: entry.grnCount > 0 ? entry.total / entry.grnCount : 0,
    }));

  const grandTotal = rows.reduce((sum, row) => sum + row.totalPurchases, 0);

  return {
    id: "supplier-spending",
    title: "Supplier Spending Report",
    category: "Operations",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Total Spend", value: currencyValue(grandTotal, clinicMeta.currency) },
      { label: "Suppliers", value: String(rows.length) },
      { label: "GRNs Received", value: String(grns.length) },
    ],

    columns: [
      { key: "supplier", label: "Supplier", format: "text" },
      { key: "totalPurchases", label: "Total Purchases", format: "currency" },
      { key: "grnCount", label: "GRNs", format: "number" },
      { key: "averagePurchase", label: "Average Purchase Value", format: "currency" },
    ],
    rows,
    totalsRow: {
      supplier: "Total",
      totalPurchases: grandTotal,
      grnCount: grns.length,
    },
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
