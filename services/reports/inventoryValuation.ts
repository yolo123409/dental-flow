import { getInventoryItems, getStockStatus, getExpiryStatus } from "@/services/inventory";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta } from "./shared";

/**
 * A current-state snapshot, not a period report - inventory quantity has
 * no historical "as of a past date" view in this schema, and the Reports
 * Center's date filter is intentionally not applied here (matching
 * section 20's own filter list for this report, which doesn't include a
 * date filter either). Total Inventory Value uses quantity x cost_per_unit
 * per item - the exact same formula the Inventory list page's own
 * "Inventory Value" stat card already uses - so this report can never
 * disagree with what a clinic owner sees on the Inventory page (section
 * 25). This is deliberately the simpler, blended-cost figure rather than
 * the batch-aware calculateStockValue() used on an individual item's
 * detail page - see the notice below for why, and why that's fine here.
 */
export async function generateInventoryValuationReport(
  _period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const [clinicMeta, items] = await Promise.all([
    getClinicMeta(),
    getInventoryItems(),
  ]);

  const filtered = filters.categoryId
    ? items.filter((item) => item.category === filters.categoryId)
    : items;

  let totalUnits = 0;
  let totalValue = 0;
  let lowStock = 0;
  let expired = 0;
  let expiringSoon = 0;

  const rows = filtered.map((item) => {
    const quantity = Number(item.quantity);
    const cost = Number(item.cost_per_unit);
    const value = quantity * cost;

    totalUnits += quantity;
    totalValue += value;

    const stockStatus = getStockStatus(quantity, Number(item.minimum_stock_level));
    if (stockStatus === "Low Stock" || stockStatus === "Out of Stock") lowStock += 1;

    const expiryStatus = getExpiryStatus(item.expiry_date);
    if (expiryStatus === "Expired") expired += 1;
    if (expiryStatus === "Expiring Soon") expiringSoon += 1;

    return {
      item: item.name,
      category: item.category ?? "—",
      quantity,
      unitCost: cost,
      stockValue: value,
      batch: item.batch_number ?? "—",
      expiry: item.expiry_date,
    };
  });

  return {
    id: "inventory-valuation",
    title: "Inventory Valuation Report",
    category: "Operations",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: "All Time",
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Total Inventory Units", value: new Intl.NumberFormat().format(totalUnits) },
      { label: "Total Inventory Value", value: currencyValue(totalValue, clinicMeta.currency) },
      { label: "Low Stock Items", value: String(lowStock) },
      { label: "Expired / Expiring", value: `${expired} / ${expiringSoon}` },
    ],

    columns: [
      { key: "item", label: "Item", format: "text" },
      { key: "category", label: "Category", format: "text" },
      { key: "quantity", label: "Quantity", format: "number" },
      { key: "unitCost", label: "Unit Cost", format: "currency" },
      { key: "stockValue", label: "Stock Value", format: "currency" },
      { key: "batch", label: "Batch", format: "text" },
      { key: "expiry", label: "Expiry", format: "date" },
    ],
    rows,
    totalsRow: {
      item: "Total",
      quantity: totalUnits,
      stockValue: totalValue,
    },

    notices: [
      {
        tone: "info",
        message:
          "Stock Value uses each item's current cost per unit (matching the Inventory page's own Inventory Value total). An item's detail page can show a more precise batch-by-batch valuation when different batches were received at different costs.",
      },
    ],
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
