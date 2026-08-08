import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";

export interface ClinicInventoryItem {
  id: string;

  clinic_id: string;

  name: string;

  category: string | null;

  quantity: number;

  unit: string;

  cost_per_unit: number;

  minimum_stock_level: number;

  batch_number: string | null;

  expiry_date: string | null;

  notes: string | null;

  // Pricing (all nullable - NULL means not configured yet, never treated as 0).
  selling_price: number | null;
  target_markup_percent: number | null;
  priced_at_cost: number | null;

  created_at: string;

  updated_at: string;
}

/**
 * Rounds a percentage to one decimal place - matches the precision shown
 * throughout the spec ("28.6%", "33.3%"). Money uses roundMoney (2dp)
 * everywhere else in this module.
 */
function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Pure pricing math, deliberately kept in one place and reused by the
 * item form, the list page, and the detail page - no DB access here.
 * "Current markup"/gross margin are ALWAYS computed live from
 * cost_per_unit/selling_price, never read from a stored percentage
 * (target_markup_percent is a separate, intentionally stale "what the
 * clinic last intended" value - see services/inventory.ts callers).
 */
export function calculateSellingPriceFromMarkup(
  cost: number,
  markupPercent: number
): number {
  return roundMoney(cost * (1 + markupPercent / 100));
}

export function calculateMarkupFromPrices(
  cost: number,
  sellingPrice: number
): number | null {
  if (cost <= 0) return null;

  return roundPercent(((sellingPrice - cost) / cost) * 100);
}

export function calculateGrossMargin(
  cost: number,
  sellingPrice: number
): number | null {
  if (sellingPrice <= 0) return null;

  return roundPercent(((sellingPrice - cost) / sellingPrice) * 100);
}

export function calculateGrossProfitPerUnit(
  cost: number,
  sellingPrice: number
): number {
  return roundMoney(sellingPrice - cost);
}

export type StockStatus =
  | "In Stock"
  | "Low Stock"
  | "Out of Stock";

export type ExpiryStatus =
  | "Expired"
  | "Expiring Soon";

const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Single source of truth for stock status - reused by the inventory
 * table's per-row badge and the dashboard's Low Stock/Out of Stock
 * counts, so there's exactly one place that encodes these thresholds.
 */
export function getStockStatus(
  quantity: number,
  minimumStockLevel: number
): StockStatus {
  if (quantity <= 0) return "Out of Stock";

  if (quantity <= minimumStockLevel) return "Low Stock";

  return "In Stock";
}

/**
 * Expiry is tracked separately from stock status (a material can be both
 * "In Stock" and "Expiring Soon" at once) - deliberately not merged into
 * StockStatus. Returns null when there's no expiry date, or it's further
 * out than the warning window.
 */
export function getExpiryStatus(
  expiryDate: string | null
): ExpiryStatus | null {
  if (!expiryDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.round(
    (expiry.getTime() - today.getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (daysUntilExpiry < 0) return "Expired";

  if (daysUntilExpiry <= EXPIRING_SOON_WINDOW_DAYS) {
    return "Expiring Soon";
  }

  return null;
}

/* -------------------------------------- */
/* Get Inventory Items                    */
/* -------------------------------------- */

export async function getInventoryItems(): Promise<
  ClinicInventoryItem[]
> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_items")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("name");

  if (error) {
    logError("[inventory] getInventoryItems failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as ClinicInventoryItem[];
}

export async function getInventoryItem(
  id: string
): Promise<ClinicInventoryItem> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_items")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .single();

  if (error) {
    logError("[inventory] getInventoryItem failed:", error);

    throw toError(error);
  }

  return data as ClinicInventoryItem;
}

/**
 * Lightweight projection for the sidebar's "needs attention" badge - only
 * the columns needed to compute stock/expiry status, not full rows. Used
 * exclusively by hooks/useInventoryAttentionCount.ts.
 */
export interface InventoryAttentionRow {
  quantity: number;
  minimum_stock_level: number;
  expiry_date: string | null;
}

export async function getInventoryAttentionSummary(): Promise<
  InventoryAttentionRow[]
> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_items")
      .select(
        "quantity, minimum_stock_level, expiry_date"
      )
      .eq("clinic_id", clinicId);

  if (error) {
    logError(
      "[inventory] getInventoryAttentionSummary failed:",
      error
    );

    throw toError(error);
  }

  return (
    data ?? []
  ) as InventoryAttentionRow[];
}

/**
 * Counts materials needing attention (low stock, out of stock, expiring
 * soon, or expired), de-duplicated so a material matching more than one
 * condition (e.g. low stock AND expiring soon) is only counted once.
 */
export function countAttentionItems(
  rows: InventoryAttentionRow[]
): number {
  return rows.filter((row) => {
    const stockStatus = getStockStatus(
      Number(row.quantity),
      Number(row.minimum_stock_level)
    );

    const expiryStatus = getExpiryStatus(
      row.expiry_date
    );

    return (
      stockStatus !== "In Stock" ||
      expiryStatus !== null
    );
  }).length;
}

/* -------------------------------------- */
/* Create Inventory Item                  */
/* -------------------------------------- */

export interface InventoryItemInput {
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  cost_per_unit: number;
  minimum_stock_level: number;
  batch_number: string | null;
  expiry_date: string | null;
  notes: string | null;
  selling_price?: number | null;
  target_markup_percent?: number | null;
  priced_at_cost?: number | null;
}

export async function createInventoryItem(
  input: InventoryItemInput
): Promise<ClinicInventoryItem> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_items")
      .insert({
        clinic_id: clinicId,

        name: input.name.trim(),
        category:
          input.category?.trim() || null,

        quantity: input.quantity,
        unit: input.unit,

        cost_per_unit:
          input.cost_per_unit,
        minimum_stock_level:
          input.minimum_stock_level,

        batch_number:
          input.batch_number?.trim() || null,
        expiry_date:
          input.expiry_date || null,

        notes:
          input.notes?.trim() || null,

        selling_price: input.selling_price ?? null,
        target_markup_percent: input.target_markup_percent ?? null,
        priced_at_cost: input.priced_at_cost ?? null,
      })
      .select()
      .single();

  if (error) {
    logError("[inventory] createInventoryItem failed:", error);

    throw toError(error);
  }

  const item = data as ClinicInventoryItem;

  if (input.quantity > 0) {
    await recordMovement({
      clinicId,
      inventoryItemId: item.id,
      quantityChange: input.quantity,
      quantityBefore: 0,
      quantityAfter: input.quantity,
      reason: "Initial Stock",
    });
  }

  return item;
}

/* -------------------------------------- */
/* Update Inventory Item (metadata only - */
/* quantity changes go through            */
/* adjustStock)                           */
/* -------------------------------------- */

export type InventoryItemMetadataInput = Omit<
  InventoryItemInput,
  "quantity"
>;

export async function updateInventoryItem(
  id: string,
  input: InventoryItemMetadataInput
): Promise<void> {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("clinic_inventory_items")
      .update({
        name: input.name.trim(),
        category:
          input.category?.trim() || null,

        unit: input.unit,

        cost_per_unit:
          input.cost_per_unit,
        minimum_stock_level:
          input.minimum_stock_level,

        batch_number:
          input.batch_number?.trim() || null,
        expiry_date:
          input.expiry_date || null,

        notes:
          input.notes?.trim() || null,

        selling_price: input.selling_price ?? null,
        target_markup_percent: input.target_markup_percent ?? null,
        priced_at_cost: input.priced_at_cost ?? null,

        updated_at:
          new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    logError("[inventory] updateInventoryItem failed:", error);

    throw toError(error);
  }
}

/**
 * Pricing-only update, used by the detail page's standalone "Apply
 * Markup" action (and any other quick-price interaction) that doesn't
 * have the rest of the item's metadata loaded into an edit form - mirrors
 * updateInventoryItem's clinic-scoped update shape exactly.
 */
export async function updateInventoryItemPricing(
  id: string,
  input: {
    selling_price: number | null;
    target_markup_percent: number | null;
    priced_at_cost: number | null;
  }
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_inventory_items")
    .update({
      selling_price: input.selling_price,
      target_markup_percent: input.target_markup_percent,
      priced_at_cost: input.priced_at_cost,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[inventory] updateInventoryItemPricing failed:", error);

    throw toError(error);
  }
}

/* -------------------------------------- */
/* Adjust Stock                           */
/* -------------------------------------- */

export type MovementReason =
  | "Restock"
  | "Used"
  | "Damaged"
  | "Expired"
  | "Correction"
  | "Other";

export async function adjustStock(
  id: string,
  delta: number,
  reason: MovementReason,
  notes?: string
): Promise<ClinicInventoryItem> {
  if (delta === 0) {
    throw new Error(
      "Enter a quantity greater than 0."
    );
  }

  const clinicId =
    await getCurrentClinicId();

  const {
    data: current,
    error: fetchError,
  } = await supabase
    .from("clinic_inventory_items")
    .select("quantity")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (fetchError) {
    logError("[inventory] adjustStock (load item) failed:", fetchError);

    throw toError(fetchError);
  }

  const quantityBefore = Number(
    current.quantity
  );

  const newQuantity = quantityBefore + delta;

  if (newQuantity < 0) {
    throw new Error(
      `Cannot remove more than the current stock (${quantityBefore} available).`
    );
  }

  const { data, error } =
    await supabase
      .from("clinic_inventory_items")
      .update({
        quantity: newQuantity,

        updated_at:
          new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .select()
      .single();

  if (error) {
    logError("[inventory] adjustStock (update) failed:", error);

    throw toError(error);
  }

  await recordMovement({
    clinicId,
    inventoryItemId: id,
    quantityChange: delta,
    quantityBefore,
    quantityAfter: newQuantity,
    reason,
    notes,
  });

  return data as ClinicInventoryItem;
}

/* -------------------------------------- */
/* Delete Inventory Item                  */
/* -------------------------------------- */

export async function deleteInventoryItem(
  id: string
): Promise<void> {
  const clinicId =
    await getCurrentClinicId();

  const { error } =
    await supabase
      .from("clinic_inventory_items")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);

  if (error) {
    logError("[inventory] deleteInventoryItem failed:", error);

    throw toError(error);
  }
}

/* -------------------------------------- */
/* Stock Movements (audit trail)          */
/* -------------------------------------- */

export interface InventoryMovement {
  id: string;

  clinic_id: string;

  inventory_item_id: string;

  movement_type: "Increase" | "Decrease";

  quantity_change: number;

  quantity_before: number;

  quantity_after: number;

  reason: string;

  notes: string | null;

  created_by: string | null;

  created_at: string;

  clinic_users?: {
    full_name: string;
  } | null;

  clinic_inventory_items?: {
    name: string;
    unit: string;
  } | null;
}

async function recordMovement(params: {
  clinicId: string;
  inventoryItemId: string;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  notes?: string;
}) {
  const actor = await getCurrentClinicUser();

  const { error } = await supabase
    .from("clinic_inventory_movements")
    .insert({
      clinic_id: params.clinicId,

      inventory_item_id:
        params.inventoryItemId,

      movement_type:
        params.quantityChange > 0
          ? "Increase"
          : "Decrease",

      quantity_change:
        params.quantityChange,

      quantity_before:
        params.quantityBefore,
      quantity_after:
        params.quantityAfter,

      reason: params.reason,
      notes: params.notes?.trim() || null,

      created_by: actor?.id ?? null,
    });

  if (error) {
    logError("[inventory] recordMovement failed:", error);

    throw toError(error);
  }
}

export async function getMovementHistory(
  inventoryItemId: string
): Promise<InventoryMovement[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_movements")
      .select(
        `
        *,
        clinic_users (
          full_name
        )
      `
      )
      .eq("clinic_id", clinicId)
      .eq(
        "inventory_item_id",
        inventoryItemId
      )
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    logError("[inventory] getMovementHistory failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as InventoryMovement[];
}

export async function getRecentMovements(
  limit = 8
): Promise<InventoryMovement[]> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("clinic_inventory_movements")
      .select(
        `
        *,
        clinic_users (
          full_name
        ),
        clinic_inventory_items (
          name,
          unit
        )
      `
      )
      .eq("clinic_id", clinicId)
      .order("created_at", {
        ascending: false,
      })
      .limit(limit);

  if (error) {
    logError("[inventory] getRecentMovements failed:", error);

    throw toError(error);
  }

  return (
    data ?? []
  ) as InventoryMovement[];
}
