import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";
import { generateDocumentNumber } from "@/lib/documentNumber";
import { localDateString } from "@/lib/dateUtils";

import {
  PurchaseOrder,
  PurchaseOrderWithItems,
  PurchaseOrderHeaderInput,
  PurchaseOrderItemInput,
  PurchaseOrderStatus,
} from "@/types/procurement";

// clinic_purchase_orders has TWO foreign keys into clinic_supplier_contacts
// (supplier_contact_id and sent_to_contact_id) - a plain
// "clinic_supplier_contacts(*)" embed is ambiguous to PostgREST (PGRST201,
// "more than one relationship was found") regardless of RLS/migration
// state. The "!supplier_contact_id" hint pins the embed to that specific
// FK column, which is the assigned contact (not the "sent to" one).
const PO_LIST_SELECT =
  "*, clinic_suppliers(name), clinic_supplier_contacts!supplier_contact_id(*)";

const PO_DETAIL_SELECT = `${PO_LIST_SELECT}, clinic_purchase_order_items(*, clinic_inventory_items(name, unit))`;

async function getPoPrefix(clinicId: string): Promise<string> {
  const { data } = await supabase
    .from("clinic_procurement_settings")
    .select("po_prefix")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  return data?.po_prefix ?? "PO";
}

export async function getPurchaseOrders(
  filters: { status?: PurchaseOrderStatus; supplierId?: string } = {}
): Promise<PurchaseOrder[]> {
  await assertPermission("procurement");

  const clinicId = await getCurrentClinicId();

  // Paged rather than a single unbounded fetch - procurement volume is
  // typically far lower than patient/invoice volume, but a long-lived
  // busy clinic could still plausibly cross 1,000 purchase orders over
  // time.
  let data: PurchaseOrder[];

  try {
    data = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("clinic_purchase_orders")
        .select(PO_LIST_SELECT)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false });

      if (filters.status) {
        query = query.eq("status", filters.status);
      }

      if (filters.supplierId) {
        query = query.eq("supplier_id", filters.supplierId);
      }

      return query.range(from, to);
    })) as unknown as PurchaseOrder[];
  } catch (error) {
    logError("[purchaseOrders] getPurchaseOrders failed:", error);

    throw error;
  }

  return data;
}

export async function getPurchaseOrder(
  id: string
): Promise<PurchaseOrderWithItems> {
  await assertPermission("procurement");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_purchase_orders")
    .select(PO_DETAIL_SELECT)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    logError("[purchaseOrders] getPurchaseOrder failed:", error);

    throw toError(error);
  }

  const po = data as unknown as PurchaseOrderWithItems;

  po.clinic_purchase_order_items = po.clinic_purchase_order_items.sort(
    (a, b) => a.display_order - b.display_order
  );

  return po;
}

export async function createDraftPurchaseOrder(
  input: PurchaseOrderHeaderInput
): Promise<PurchaseOrder> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const prefix = await getPoPrefix(clinicId);
  const poNumber = await generateDocumentNumber(
    clinicId,
    "purchase_order",
    prefix
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: clinicUser } = await supabase
    .from("clinic_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("clinic_purchase_orders")
    .insert({
      clinic_id: clinicId,
      po_number: poNumber,
      supplier_id: input.supplier_id,
      supplier_contact_id: input.supplier_contact_id ?? null,
      order_date: input.order_date ?? localDateString(new Date()),
      expected_delivery_date: input.expected_delivery_date ?? null,
      delivery_location: input.delivery_location ?? null,
      notes: input.notes ?? null,
      created_by: clinicUser?.id ?? null,
    })
    .select()
    .single();

  if (error) {
    logError("[purchaseOrders] createDraftPurchaseOrder failed:", error);

    throw toError(error);
  }

  return data as PurchaseOrder;
}

export async function updatePurchaseOrderHeader(
  id: string,
  input: PurchaseOrderHeaderInput
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_purchase_orders")
    .update({
      supplier_id: input.supplier_id,
      supplier_contact_id: input.supplier_contact_id ?? null,
      order_date: input.order_date,
      expected_delivery_date: input.expected_delivery_date ?? null,
      delivery_location: input.delivery_location ?? null,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[purchaseOrders] updatePurchaseOrderHeader failed:", error);

    throw toError(error);
  }
}

async function recalcTotals(poId: string): Promise<void> {
  const { error } = await supabase.rpc("recalculate_purchase_order_totals", {
    p_po_id: poId,
  });

  if (error) {
    logError("[purchaseOrders] recalculate_purchase_order_totals failed:", error);

    throw toError(error);
  }
}

export async function addPurchaseOrderItem(
  poId: string,
  input: PurchaseOrderItemInput,
  displayOrder: number
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const lineTotal = Math.round(input.quantity * input.unit_price * 100) / 100;

  const { error } = await supabase.from("clinic_purchase_order_items").insert({
    purchase_order_id: poId,
    clinic_id: clinicId,
    inventory_item_id: input.inventory_item_id,
    description: input.description ?? null,
    quantity: input.quantity,
    unit: input.unit,
    unit_price: input.unit_price,
    line_total: lineTotal,
    display_order: displayOrder,
  });

  if (error) {
    logError("[purchaseOrders] addPurchaseOrderItem failed:", error);

    throw toError(error);
  }

  await recalcTotals(poId);
}

export async function updatePurchaseOrderItem(
  itemId: string,
  poId: string,
  input: PurchaseOrderItemInput
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const lineTotal = Math.round(input.quantity * input.unit_price * 100) / 100;

  const { error } = await supabase
    .from("clinic_purchase_order_items")
    .update({
      inventory_item_id: input.inventory_item_id,
      description: input.description ?? null,
      quantity: input.quantity,
      unit: input.unit,
      unit_price: input.unit_price,
      line_total: lineTotal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[purchaseOrders] updatePurchaseOrderItem failed:", error);

    throw toError(error);
  }

  await recalcTotals(poId);
}

export async function removePurchaseOrderItem(
  itemId: string,
  poId: string
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_purchase_order_items")
    .delete()
    .eq("id", itemId)
    .eq("clinic_id", clinicId);

  if (error) {
    logError("[purchaseOrders] removePurchaseOrderItem failed:", error);

    throw toError(error);
  }

  await recalcTotals(poId);
}

export async function sendPurchaseOrder(
  id: string,
  via: "Email" | "WhatsApp",
  contactId: string | null
): Promise<void> {
  await assertPermission("procurement_manage");

  const { error } = await supabase.rpc("mark_purchase_order_sent", {
    p_po_id: id,
    p_via: via,
    p_contact_id: contactId,
  });

  if (error) {
    logError("[purchaseOrders] sendPurchaseOrder failed:", error);

    throw toError(error);
  }
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
  await assertPermission("procurement_manage");

  const { error } = await supabase.rpc("cancel_purchase_order", {
    p_po_id: id,
  });

  if (error) {
    logError("[purchaseOrders] cancelPurchaseOrder failed:", error);

    throw toError(error);
  }
}
