export interface Supplier {
  id: string;
  clinic_id: string;
  name: string;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  clinic_id: string;
  name: string;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  is_primary: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierWithContacts extends Supplier {
  clinic_supplier_contacts: SupplierContact[];
}

export interface SupplierInput {
  name: string;
  address?: string | null;
  notes?: string | null;
}

export interface SupplierContactInput {
  name: string;
  job_title?: string | null;
  department?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  email?: string | null;
  is_primary?: boolean;
  notes?: string | null;
}

export type PurchaseOrderStatus =
  | "Draft"
  | "Sent"
  | "Partially Received"
  | "Received"
  | "Cancelled";

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  clinic_id: string;
  inventory_item_id: string;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  display_order: number;
  created_at: string;
  updated_at: string;
  clinic_inventory_items?: { name: string; unit: string } | null;
}

export interface PurchaseOrder {
  id: string;
  clinic_id: string;
  po_number: string;
  supplier_id: string;
  supplier_contact_id: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  delivery_location: string | null;
  notes: string | null;
  status: PurchaseOrderStatus;
  subtotal: number;
  total: number;
  custom_fields: Record<string, string>;
  created_by: string | null;
  sent_at: string | null;
  sent_via: "Email" | "WhatsApp" | null;
  sent_to_contact_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  clinic_suppliers?: { name: string } | null;
  clinic_supplier_contacts?: SupplierContact | null;
}

export interface PurchaseOrderWithItems extends PurchaseOrder {
  clinic_purchase_order_items: PurchaseOrderItem[];
}

export interface PurchaseOrderHeaderInput {
  supplier_id: string;
  supplier_contact_id?: string | null;
  order_date?: string;
  expected_delivery_date?: string | null;
  delivery_location?: string | null;
  notes?: string | null;
}

export interface PurchaseOrderItemInput {
  inventory_item_id: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
}

export interface ProcurementSettings {
  clinic_id: string;
  po_prefix: string;
  po_document_title: string;
  po_header_text: string | null;
  po_footer_text: string | null;
  po_default_notes: string | null;
  po_terms: string | null;
  po_signature_label: string;
  po_custom_fields: CustomFieldDefinition[];
  grn_prefix: string;
  grn_document_title: string;
  grn_header_text: string | null;
  grn_footer_text: string | null;
  grn_visible_columns: {
    ordered: boolean;
    received: boolean;
    unit: boolean;
    unit_cost: boolean;
    batch: boolean;
    expiry: boolean;
  };
  grn_signature_label: string;
  grn_custom_fields: CustomFieldDefinition[];
}

export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "date";
  required: boolean;
  display_order: number;
}

export type GRNStatus = "Draft" | "Received" | "Cancelled";

export interface GRNItem {
  id: string;
  grn_id: string;
  clinic_id: string;
  purchase_order_item_id: string | null;
  inventory_item_id: string;
  description: string | null;
  quantity_ordered: number | null;
  quantity_previously_received: number;
  quantity_received: number;
  unit: string;
  unit_cost: number;
  batch_number: string | null;
  expiry_date: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  clinic_inventory_items?: { name: string; unit: string } | null;
}

export interface GRN {
  id: string;
  clinic_id: string;
  grn_number: string;
  purchase_order_id: string | null;
  supplier_id: string;
  supplier_contact_id: string | null;
  supplier_delivery_note: string | null;
  date_received: string;
  status: GRNStatus;
  received_by: string | null;
  received_at: string | null;
  notes: string | null;
  custom_fields: Record<string, string>;
  sent_at: string | null;
  sent_via: "Email" | "WhatsApp" | null;
  sent_to_contact_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  clinic_suppliers?: { name: string } | null;
  clinic_supplier_contacts?: SupplierContact | null;
  clinic_purchase_orders?: { po_number: string } | null;
}

export interface GRNWithItems extends GRN {
  clinic_grn_items: GRNItem[];
}

export interface GRNHeaderInput {
  supplier_id: string;
  supplier_contact_id?: string | null;
  supplier_delivery_note?: string | null;
  date_received?: string;
  notes?: string | null;
}

export interface GRNItemInput {
  purchase_order_item_id?: string | null;
  inventory_item_id: string;
  description?: string | null;
  quantity_ordered?: number | null;
  quantity_previously_received?: number;
  quantity_received: number;
  unit: string;
  unit_cost?: number;
  batch_number?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
}
