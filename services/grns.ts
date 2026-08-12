import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { getPurchaseOrder } from "./purchaseOrders";
import { generateDocumentNumber } from "@/lib/documentNumber";

import {
  GRN,
  GRNWithItems,
  GRNHeaderInput,
  GRNItemInput,
  GRNStatus,
} from "@/types/procurement";

// Same ambiguous-relationship issue as services/purchaseOrders.ts:
// clinic_goods_received_notes has TWO foreign keys into
// clinic_supplier_contacts (supplier_contact_id and sent_to_contact_id),
// so the embed must be pinned to the specific FK column or PostgREST
// rejects the query with PGRST201 ("more than one relationship was
// found"). clinic_purchase_orders has only one FK from this table
// (purchase_order_id), so that embed is unambiguous as-is.
const GRN_LIST_SELECT =
  "*, clinic_suppliers(name), clinic_supplier_contacts!supplier_contact_id(*), clinic_purchase_orders(po_number)";

const GRN_DETAIL_SELECT = `${GRN_LIST_SELECT}, clinic_grn_items(*, clinic_inventory_items(name, unit))`;

async function getGrnPrefix(clinicId: string): Promise<string> {
  const { data } = await supabase
    .from("clinic_procurement_settings")
    .select("grn_prefix")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  return data?.grn_prefix ?? "GRN";
}

export async function getGRNs(
  filters: {
    status?: GRNStatus;
    purchaseOrderId?: string;
    supplierId?: string;
  } = {}
): Promise<GRN[]> {
  const clinicId = await getCurrentClinicId();

  let query = supabase
    .from("clinic_goods_received_notes")
    .select(GRN_LIST_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.purchaseOrderId) {
    query = query.eq("purchase_order_id", filters.purchaseOrderId);
  }

  if (filters.supplierId) {
    query = query.eq("supplier_id", filters.supplierId);
  }

  const { data, error } = await query;

  if (error) {
    logError("[grns] getGRNs failed:", error);

    throw toError(error);
  }

  return (data ?? []) as unknown as GRN[];
}

export async function getGRN(id: string): Promise<GRNWithItems> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_goods_received_notes")
    .select(GRN_DETAIL_SELECT)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    logError("[grns] getGRN failed:", error);

    throw toError(error);
  }

  const grn = data as unknown as GRNWithItems;

  grn.clinic_grn_items = grn.clinic_grn_items.sort(
    (a, b) => a.display_order - b.display_order
  );

  return grn;
}

/**
 * Freshly recomputes how much of a PO item has already been received
 * across CONFIRMED sibling GRNs - the same shape of query
 * confirm_grn_receipt itself uses at confirm time, so what the user sees
 * while filling out "Receiving Now" matches what will actually be
 * validated when they confirm.
 */
async function getAlreadyReceived(
  purchaseOrderItemId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("clinic_grn_items")
    .select("quantity_received, clinic_goods_received_notes!inner(status)")
    .eq("purchase_order_item_id", purchaseOrderItemId)
    .eq("clinic_goods_received_notes.status", "Received");

  if (error) {
    logError("[grns] getAlreadyReceived failed:", error);

    throw toError(error);
  }

  return (data ?? []).reduce(
    (sum, row) => sum + Number(row.quantity_received),
    0
  );
}

/**
 * Creates a Draft GRN pre-filled from a Purchase Order's lines - ordered/
 * previously-received are display snapshots computed fresh right now;
 * "receiving now" defaults to the full remaining amount (the common
 * full-delivery case), which the user can edit down for a partial
 * delivery before confirming.
 */
export async function createGRNFromPurchaseOrder(
  poId: string
): Promise<GRN> {
  const clinicId = await getCurrentClinicId();
  const po = await getPurchaseOrder(poId);

  const prefix = await getGrnPrefix(clinicId);
  const grnNumber = await generateDocumentNumber(clinicId, "grn", prefix);

  const { data: grn, error } = await supabase
    .from("clinic_goods_received_notes")
    .insert({
      clinic_id: clinicId,
      grn_number: grnNumber,
      purchase_order_id: poId,
      supplier_id: po.supplier_id,
      supplier_contact_id: po.supplier_contact_id,
    })
    .select()
    .single();

  if (error) {
    logError("[grns] createGRNFromPurchaseOrder (header) failed:", error);

    throw toError(error);
  }

  const lines = await Promise.all(
    po.clinic_purchase_order_items.map(async (item, index) => {
      const alreadyReceived = await getAlreadyReceived(item.id);
      const remaining = Math.max(0, Number(item.quantity) - alreadyReceived);

      return {
        grn_id: grn.id,
        clinic_id: clinicId,
        purchase_order_item_id: item.id,
        inventory_item_id: item.inventory_item_id,
        description: item.description,
        quantity_ordered: item.quantity,
        quantity_previously_received: alreadyReceived,
        quantity_received: remaining,
        unit: item.unit,
        unit_cost: item.unit_price,
        display_order: index,
      };
    })
  );

  if (lines.length > 0) {
    const { error: itemsError } = await supabase
      .from("clinic_grn_items")
      .insert(lines);

    if (itemsError) {
      logError("[grns] createGRNFromPurchaseOrder (items) failed:", itemsError);

      throw toError(itemsError);
    }
  }

  return grn as GRN;
}

export async function createManualGRN(input: GRNHeaderInput): Promise<GRN> {
  const clinicId = await getCurrentClinicId();

  const prefix = await getGrnPrefix(clinicId);
  const grnNumber = await generateDocumentNumber(clinicId, "grn", prefix);

  const { data, error } = await supabase
    .from("clinic_goods_received_notes")
    .insert({
      clinic_id: clinicId,
      grn_number: grnNumber,
      purchase_order_id: null,
      supplier_id: input.supplier_id,
      supplier_contact_id: input.supplier_contact_id ?? null,
      supplier_delivery_note: input.supplier_delivery_note ?? null,
      date_received: input.date_received ?? new Date().toISOString().slice(0, 10),
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    logError("[grns] createManualGRN failed:", error);

    throw toError(error);
  }

  return data as GRN;
}

export async function updateGRNHeader(
  id: string,
  input: GRNHeaderInput
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_goods_received_notes")
    .update({
      supplier_delivery_note: input.supplier_delivery_note ?? null,
      date_received: input.date_received,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[grns] updateGRNHeader failed:", error);

    throw toError(error);
  }
}

export async function addGRNItem(
  grnId: string,
  input: GRNItemInput,
  displayOrder: number
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase.from("clinic_grn_items").insert({
    grn_id: grnId,
    clinic_id: clinicId,
    purchase_order_item_id: input.purchase_order_item_id ?? null,
    inventory_item_id: input.inventory_item_id,
    description: input.description ?? null,
    quantity_ordered: input.quantity_ordered ?? null,
    quantity_previously_received: input.quantity_previously_received ?? 0,
    quantity_received: input.quantity_received,
    unit: input.unit,
    unit_cost: input.unit_cost ?? 0,
    batch_number: input.batch_number ?? null,
    expiry_date: input.expiry_date ?? null,
    notes: input.notes ?? null,
    display_order: displayOrder,
  });

  if (error) {
    logError("[grns] addGRNItem failed:", error);

    throw toError(error);
  }
}

export async function updateGRNItem(
  itemId: string,
  input: GRNItemInput
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_grn_items")
    .update({
      inventory_item_id: input.inventory_item_id,
      description: input.description ?? null,
      quantity_received: input.quantity_received,
      unit: input.unit,
      unit_cost: input.unit_cost ?? 0,
      batch_number: input.batch_number ?? null,
      expiry_date: input.expiry_date ?? null,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[grns] updateGRNItem failed:", error);

    throw toError(error);
  }
}

export async function removeGRNItem(itemId: string): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_grn_items")
    .delete()
    .eq("id", itemId)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[grns] removeGRNItem failed:", error);

    throw toError(error);
  }
}

export async function confirmGRNReceipt(id: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_grn_receipt", {
    p_grn_id: id,
  });

  if (error) {
    logError("[grns] confirmGRNReceipt failed:", error);

    throw toError(error);
  }
}

export async function sendGRN(
  id: string,
  via: "Email" | "WhatsApp",
  contactId: string | null
): Promise<void> {
  const { error } = await supabase.rpc("mark_grn_sent", {
    p_grn_id: id,
    p_via: via,
    p_contact_id: contactId,
  });

  if (error) {
    logError("[grns] sendGRN failed:", error);

    throw toError(error);
  }
}

export async function cancelGRN(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_grn", { p_grn_id: id });

  if (error) {
    logError("[grns] cancelGRN failed:", error);

    throw toError(error);
  }
}
