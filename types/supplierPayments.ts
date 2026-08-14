export type SupplierPaymentStatus = "Posted" | "Voided";

export interface SupplierPayment {
  id: string;
  clinic_id: string;
  supplier_id: string;
  payment_date: string;
  payment_method: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  status: SupplierPaymentStatus;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  clinic_suppliers?: { name: string } | null;
  created_by_user?: { full_name: string } | null;
  voided_by_user?: { full_name: string } | null;
  clinic_supplier_payment_allocations?: SupplierPaymentAllocation[];
}

export interface SupplierPaymentAllocation {
  id: string;
  clinic_id: string;
  supplier_payment_id: string;
  grn_id: string;
  amount: number;
  created_at: string;
  clinic_goods_received_notes?: { grn_number: string } | null;
}

export interface OutstandingGrn {
  grnId: string;
  grnNumber: string;
  dateReceived: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

export interface SupplierApSummary {
  supplierId: string;
  supplierName: string;
  totalPurchases: number;
  totalPaid: number;
  outstanding: number;
  lastPaymentDate: string | null;
  status: "Paid" | "Partially Paid" | "Outstanding";
}

export interface AllocationInput {
  grnId: string;
  amount: number;
}

export interface RecordSupplierPaymentInput {
  supplierId: string;
  paymentDate: string;
  paymentMethod: string;
  amount: number;
  allocations: AllocationInput[];
  reference?: string;
  notes?: string;
}

export interface RepairedGrnPosting {
  grnId: string;
  grnNumber: string;
  amount: number;
  ledgerTransactionId: string;
}
