import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { roundMoney } from "@/lib/currency";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";
import { assertPermission } from "./authorization";

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

  // Paged rather than a single unbounded fetch - the SKU catalog is
  // realistically much smaller than 1,000 for a dental clinic, but paged
  // safely anyway rather than trusting that assumption to always hold.
  let data: ClinicInventoryItem[];

  try {
    data = (await fetchAllRows((from, to) =>
      supabase
        .from("clinic_inventory_items")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("name")
        .range(from, to)
    )) as unknown as ClinicInventoryItem[];
  } catch (error) {
    logError("[inventory] getInventoryItems failed:", error);

    throw error;
  }

  return data;
}

export async function getInventoryItem(
  id: string
): Promise<ClinicInventoryItem> {
  await assertPermission("inventory");

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
  await assertPermission("inventory");

  const clinicId =
    await getCurrentClinicId();

  // Paged rather than a single unbounded fetch - same catalog table as
  // getInventoryItems above.
  let data: InventoryAttentionRow[];

  try {
    data = (await fetchAllRows((from, to) =>
      supabase
        .from("clinic_inventory_items")
        .select("quantity, minimum_stock_level, expiry_date")
        .eq("clinic_id", clinicId)
        .range(from, to)
    )) as unknown as InventoryAttentionRow[];
  } catch (error) {
    logError(
      "[inventory] getInventoryAttentionSummary failed:",
      error
    );

    throw error;
  }

  return data;
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
  await assertPermission("inventory_manage");

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
    await recordInitialStockMovement({
      clinicId,
      inventoryItemId: item.id,
      quantity: input.quantity,
      batchNumber: input.batch_number,
      expiryDate: input.expiry_date,
      unitCost: input.cost_per_unit,
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
  await assertPermission("inventory_manage");

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
  await assertPermission("inventory_manage");

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
/* Adjust Stock (atomic - see migration   */
/* 0042/adjust_inventory_stock)           */
/* -------------------------------------- */

export type MovementReason =
  | "Restock"
  | "Used"
  | "Damaged"
  | "Expired"
  | "Correction"
  | "Returned to Supplier"
  | "Other";

export interface AdjustStockExtras {
  batchNumber?: string | null;
  expiryDate?: string | null;
  supplierId?: string | null;
  patientId?: string | null;
  treatmentId?: string | null;
  reference?: string | null;
}

/**
 * Every non-GRN stock change (manual adjustments, consumption, damage,
 * returns to supplier) goes through this one RPC, which updates the
 * item's quantity and inserts its movement row in a single transaction -
 * closing the two-network-call gap the previous version of this function
 * had (see migration 0042's header comment). The public signature is
 * unchanged for existing callers (AdjustStockModal); `extras` is new and
 * optional.
 */
export async function adjustStock(
  id: string,
  delta: number,
  reason: MovementReason,
  notes?: string,
  extras: AdjustStockExtras = {}
): Promise<ClinicInventoryItem> {
  await assertPermission("inventory_manage");

  if (delta === 0) {
    throw new Error(
      "Enter a quantity greater than 0."
    );
  }

  const { data, error } = await supabase.rpc(
    "adjust_inventory_stock",
    {
      p_item_id: id,
      p_delta: delta,
      p_reason: reason,
      p_notes: notes ?? null,
      p_batch_number: extras.batchNumber ?? null,
      p_expiry_date: extras.expiryDate ?? null,
      p_supplier_id: extras.supplierId ?? null,
      p_patient_id: extras.patientId ?? null,
      p_treatment_id: extras.treatmentId ?? null,
      p_reference: extras.reference ?? null,
    }
  );

  if (error) {
    logError("[inventory] adjustStock failed:", error);

    throw toError(error);
  }

  return data as ClinicInventoryItem;
}

/**
 * Record material used on a patient/treatment - always a decrease, reason
 * fixed to "Used". Patient and treatment are both optional per the spec
 * (section 11): this must work identically with neither selected.
 */
export async function recordConsumption(
  id: string,
  quantity: number,
  options: {
    notes?: string;
    patientId?: string | null;
    treatmentId?: string | null;
    batchNumber?: string | null;
  } = {}
): Promise<ClinicInventoryItem> {
  await assertPermission("inventory_manage");

  if (quantity <= 0) {
    throw new Error("Enter a quantity greater than 0.");
  }

  return adjustStock(id, -quantity, "Used", options.notes, {
    patientId: options.patientId,
    treatmentId: options.treatmentId,
    batchNumber: options.batchNumber,
  });
}

/**
 * Record stock physically sent back to a supplier - a supplier is
 * required (unlike consumption/damage), matching spec section 12.
 */
export async function returnToSupplier(
  id: string,
  quantity: number,
  supplierId: string,
  options: {
    reference?: string;
    notes?: string;
    batchNumber?: string | null;
  } = {}
): Promise<ClinicInventoryItem> {
  await assertPermission("inventory_manage");

  if (quantity <= 0) {
    throw new Error("Enter a quantity greater than 0.");
  }

  if (!supplierId) {
    throw new Error("Select a supplier.");
  }

  return adjustStock(id, -quantity, "Returned to Supplier", options.notes, {
    supplierId,
    reference: options.reference,
    batchNumber: options.batchNumber,
  });
}

/* -------------------------------------- */
/* Delete Inventory Item                  */
/* -------------------------------------- */

export async function deleteInventoryItem(
  id: string
): Promise<void> {
  await assertPermission("inventory_manage");

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

  unit_cost: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  patient_id: string | null;
  treatment_id: string | null;
  reference: string | null;
  grn_id: string | null;

  created_by: string | null;

  created_at: string;

  clinic_users?: {
    full_name: string;
  } | null;

  clinic_inventory_items?: {
    name: string;
    unit: string;
  } | null;

  clinic_suppliers?: {
    name: string;
  } | null;

  patients?: {
    first_name: string;
    last_name: string;
  } | null;

  clinic_treatments?: {
    name: string;
  } | null;
}

/**
 * Used only by createInventoryItem for the one-time "Initial Stock" entry
 * created alongside a brand-new item - every other movement (adjustments,
 * consumption, damage, returns, GRN receipts) goes through the atomic
 * adjust_inventory_stock/confirm_grn_receipt RPCs instead. There's no
 * existing quantity to race against here (the item row was just created
 * in the previous call with its initial quantity already set), so this
 * stays a plain insert rather than needing its own RPC.
 */
async function recordInitialStockMovement(params: {
  clinicId: string;
  inventoryItemId: string;
  quantity: number;
  batchNumber: string | null;
  expiryDate: string | null;
  unitCost: number;
}) {
  const actor = await getCurrentClinicUser();

  const { error } = await supabase
    .from("clinic_inventory_movements")
    .insert({
      clinic_id: params.clinicId,
      inventory_item_id: params.inventoryItemId,
      movement_type: "Increase",
      quantity_change: params.quantity,
      quantity_before: 0,
      quantity_after: params.quantity,
      reason: "Initial Stock",
      batch_number: params.batchNumber?.trim() || null,
      expiry_date: params.expiryDate || null,
      unit_cost: params.unitCost,
      created_by: actor?.id ?? null,
    });

  if (error) {
    logError("[inventory] recordInitialStockMovement failed:", error);

    throw toError(error);
  }
}

const MOVEMENT_DETAIL_SELECT = `
  *,
  clinic_users ( full_name ),
  clinic_suppliers ( name ),
  patients ( first_name, last_name ),
  clinic_treatments ( name )
`;

export interface MovementHistoryFilters {
  // Widened to string (rather than MovementReason) because the ledger can
  // also contain "Initial Stock", a system-recorded reason that isn't one
  // of the user-selectable adjustment reasons in MovementReason.
  reason?: string;
  batchNumber?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface MovementHistoryPage {
  rows: InventoryMovement[];
  count: number;
}

const DEFAULT_HISTORY_PAGE_SIZE = 25;

/**
 * Paginated + filterable, per spec section 27/28 - never fetches an
 * item's entire history into the browser at once. Filters are applied
 * server-side (not client-side over an already-fetched page).
 */
export async function getMovementHistory(
  inventoryItemId: string,
  filters: MovementHistoryFilters = {}
): Promise<MovementHistoryPage> {
  await assertPermission("inventory");

  const clinicId =
    await getCurrentClinicId();

  const limit = filters.limit ?? DEFAULT_HISTORY_PAGE_SIZE;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("clinic_inventory_movements")
    .select(MOVEMENT_DETAIL_SELECT, { count: "exact" })
    .eq("clinic_id", clinicId)
    .eq("inventory_item_id", inventoryItemId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.reason) {
    query = query.eq("reason", filters.reason);
  }

  if (filters.batchNumber) {
    query = query.eq("batch_number", filters.batchNumber);
  }

  if (filters.fromDate) {
    query = query.gte("created_at", filters.fromDate);
  }

  if (filters.toDate) {
    query = query.lte("created_at", filters.toDate);
  }

  const { data, error, count } = await query;

  if (error) {
    logError("[inventory] getMovementHistory failed:", error);

    throw toError(error);
  }

  return {
    rows: (data ?? []) as InventoryMovement[],
    count: count ?? 0,
  };
}

export async function getRecentMovements(
  limit = 8
): Promise<InventoryMovement[]> {
  await assertPermission("inventory");

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

/* -------------------------------------- */
/* Batches (derived from the movement     */
/* ledger - not a second mutable table,   */
/* see migration 0042's header comment)   */
/* -------------------------------------- */

export interface InventoryBatch {
  batchNumber: string | null;
  quantityRemaining: number;
  unitCost: number | null;
  expiryDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  grnId: string | null;
  receivedAt: string | null;
}

/**
 * Groups a material's full movement history by batch_number and nets each
 * group's quantity_change to a remaining quantity - the running-balance
 * property of the ledger (section 14) applied per batch instead of per
 * item. A null batch_number groups into "Unbatched". Only the columns
 * needed for aggregation are selected (not full joined rows), keeping
 * this lighter than the paginated detail history query even though it
 * has to read every movement for the item to net out correctly.
 */
export async function getInventoryBatches(
  inventoryItemId: string
): Promise<InventoryBatch[]> {
  await assertPermission("inventory");

  const clinicId = await getCurrentClinicId();

  interface Row {
    batch_number: string | null;
    quantity_change: number;
    unit_cost: number | null;
    expiry_date: string | null;
    supplier_id: string | null;
    grn_id: string | null;
    created_at: string;
    clinic_suppliers: { name: string } | null;
  }

  // Paged rather than a single unbounded fetch - a high-turnover
  // consumable can plausibly accumulate more than 1,000 movement rows
  // over its lifetime (every consumption, receipt, adjustment, and
  // return posts one), which would otherwise silently truncate this
  // read and understate quantityRemaining for real stock - a genuine
  // inventory-safety issue (a batch could read as depleted, or a
  // stockout could go uncaught), not just a display glitch.
  const data = (await fetchAllRows((from, to) =>
    supabase
      .from("clinic_inventory_movements")
      .select(
        "batch_number, quantity_change, unit_cost, expiry_date, supplier_id, grn_id, created_at, clinic_suppliers(name)"
      )
      .eq("clinic_id", clinicId)
      .eq("inventory_item_id", inventoryItemId)
      .order("created_at", { ascending: true })
      .range(from, to)
  )) as unknown as Row[];

  const groups = new Map<string, InventoryBatch>();

  for (const row of data) {
    const key = row.batch_number ?? "";

    const existing = groups.get(key) ?? {
      batchNumber: row.batch_number,
      quantityRemaining: 0,
      unitCost: null,
      expiryDate: null,
      supplierId: null,
      supplierName: null,
      grnId: null,
      receivedAt: null,
    };

    existing.quantityRemaining = roundMoney(
      existing.quantityRemaining + Number(row.quantity_change)
    );

    // Latest non-null values win, so a later re-receipt of the same batch
    // number (or a later movement that happens to carry updated metadata)
    // is reflected - rows are read oldest-first above.
    if (row.unit_cost != null) existing.unitCost = Number(row.unit_cost);
    if (row.expiry_date != null) existing.expiryDate = row.expiry_date;
    if (row.supplier_id != null) {
      existing.supplierId = row.supplier_id;
      existing.supplierName = row.clinic_suppliers?.name ?? null;
    }
    if (row.grn_id != null) existing.grnId = row.grn_id;
    if (existing.receivedAt == null && Number(row.quantity_change) > 0) {
      existing.receivedAt = row.created_at;
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .filter((batch) => batch.quantityRemaining > 0)
    .sort((a, b) => {
      // Batches with an expiry date first (soonest first), then
      // unbatched/no-expiry stock last.
      if (a.expiryDate && b.expiryDate) {
        return a.expiryDate.localeCompare(b.expiryDate);
      }
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return 0;
    });
}

/**
 * Stock Value = current quantity x cost - never selling price (spec
 * section 16). When batch-level unit costs exist, values each batch at
 * its own received cost instead of the item's single blended
 * cost_per_unit, falling back to cost_per_unit for whatever portion of
 * the quantity isn't accounted for by a costed batch (e.g. legacy stock
 * received before this feature, or a batch whose cost was never
 * recorded) - the two always sum to the item's real total quantity.
 */
export function calculateStockValue(
  item: Pick<ClinicInventoryItem, "quantity" | "cost_per_unit">,
  batches: InventoryBatch[]
): number {
  const costedBatches = batches.filter((batch) => batch.unitCost != null);

  const costedQuantity = costedBatches.reduce(
    (sum, batch) => sum + batch.quantityRemaining,
    0
  );

  const costedValue = costedBatches.reduce(
    (sum, batch) => sum + batch.quantityRemaining * (batch.unitCost ?? 0),
    0
  );

  const remainingQuantity = Math.max(
    0,
    Number(item.quantity) - costedQuantity
  );

  return roundMoney(
    costedValue + remainingQuantity * Number(item.cost_per_unit)
  );
}
