import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import {
  OutstandingGrn,
  RecordSupplierPaymentInput,
  RepairedGrnPosting,
  SupplierApSummary,
  SupplierPayment,
} from "@/types/supplierPayments";

interface RawOutstandingGrn {
  grn_id: string;
  grn_number: string;
  date_received: string;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
}

export async function getSupplierOutstandingGrns(
  supplierId: string
): Promise<OutstandingGrn[]> {
  await assertPermission("accounts_payable");

  const { data, error } = await supabase.rpc("get_supplier_outstanding_grns", {
    p_supplier_id: supplierId,
  });

  if (error) {
    logError("[supplierPayments] getSupplierOutstandingGrns failed:", error);
    throw toError(error);
  }

  return ((data ?? []) as RawOutstandingGrn[])
    .map((row) => ({
      grnId: row.grn_id,
      grnNumber: row.grn_number,
      dateReceived: row.date_received,
      totalAmount: Number(row.total_amount),
      paidAmount: Number(row.paid_amount),
      outstandingAmount: Number(row.outstanding_amount),
    }))
    .filter((row) => row.outstandingAmount > 0.01);
}

interface RawApSummary {
  supplier_id: string;
  supplier_name: string;
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  last_payment_date: string | null;
}

function summaryStatus(totalPaid: number, outstanding: number): SupplierApSummary["status"] {
  if (outstanding <= 0.01) return "Paid";
  if (totalPaid <= 0.01) return "Outstanding";
  return "Partially Paid";
}

export async function getSupplierApSummaries(): Promise<SupplierApSummary[]> {
  await assertPermission("accounts_payable");

  const { data, error } = await supabase.rpc("get_supplier_ap_summary");

  if (error) {
    logError("[supplierPayments] getSupplierApSummaries failed:", error);
    throw toError(error);
  }

  return ((data ?? []) as RawApSummary[]).map((row) => ({
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    totalPurchases: Number(row.total_purchases),
    totalPaid: Number(row.total_paid),
    outstanding: Number(row.outstanding),
    lastPaymentDate: row.last_payment_date,
    status: summaryStatus(Number(row.total_paid), Number(row.outstanding)),
  }));
}

export async function getSupplierApSummary(
  supplierId: string
): Promise<SupplierApSummary | null> {
  const all = await getSupplierApSummaries();
  return all.find((row) => row.supplierId === supplierId) ?? null;
}

/**
 * Cross-checks the GRN-minus-payments outstanding figure against the
 * ledger's own independently-computed Accounts Payable balance for this
 * supplier (section 16) - the two are built from different tables, so
 * agreement here is a real consistency check, not a tautology. Surfaces
 * a mismatch rather than silently trusting either number.
 */
export async function getSupplierApReconciliation(
  supplierId: string
): Promise<{ grnBased: number; ledgerBased: number; matches: boolean }> {
  const [summary, ledgerBalanceResult] = await Promise.all([
    getSupplierApSummary(supplierId),
    supabase.rpc("get_supplier_ledger_ap_balance", { p_supplier_id: supplierId }),
  ]);

  if (ledgerBalanceResult.error) {
    logError(
      "[supplierPayments] getSupplierApReconciliation failed:",
      ledgerBalanceResult.error
    );
    throw toError(ledgerBalanceResult.error);
  }

  const grnBased = summary?.outstanding ?? 0;
  const ledgerBased = Number(ledgerBalanceResult.data ?? 0);

  return { grnBased, ledgerBased, matches: Math.abs(grnBased - ledgerBased) < 0.01 };
}

// clinic_supplier_payments has two separate foreign keys into
// clinic_users (created_by, voided_by) - same ambiguous-relationship
// issue already documented in services/grns.ts/purchaseOrders.ts for
// clinic_supplier_contacts. An unqualified `clinic_users(...)` embed
// makes PostgREST reject the query with PGRST201 ("more than one
// relationship was found"), so each embed must be pinned to its exact
// FK constraint name.
const PAYMENT_SELECT = `
  *,
  clinic_suppliers ( name ),
  created_by_user:clinic_users!clinic_supplier_payments_created_by_fkey ( full_name ),
  voided_by_user:clinic_users!clinic_supplier_payments_voided_by_fkey ( full_name ),
  clinic_supplier_payment_allocations (
    *,
    clinic_goods_received_notes ( grn_number )
  )
`;

export async function getSupplierPayments(supplierId: string): Promise<SupplierPayment[]> {
  await assertPermission("accounts_payable");
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_supplier_payments")
    .select(PAYMENT_SELECT)
    .eq("clinic_id", clinicId)
    .eq("supplier_id", supplierId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logError("[supplierPayments] getSupplierPayments failed:", error);
    throw toError(error);
  }

  return (data ?? []) as unknown as SupplierPayment[];
}

export async function recordSupplierPayment(
  input: RecordSupplierPaymentInput
): Promise<string> {
  await assertPermission("accounts_payable_manage");

  const { data, error } = await supabase.rpc("record_supplier_payment", {
    p_supplier_id: input.supplierId,
    p_payment_date: input.paymentDate,
    p_payment_method: input.paymentMethod,
    p_amount: input.amount,
    p_allocations: input.allocations.map((a) => ({ grn_id: a.grnId, amount: a.amount })),
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
  });

  if (error) {
    logError("[supplierPayments] recordSupplierPayment failed:", error);
    throw toError(error);
  }

  return data as string;
}

interface RawRepairedGrnPosting {
  grn_id: string;
  grn_number: string;
  amount: number;
  ledger_transaction_id: string;
}

/**
 * Owner/Admin-only reconciliation repair (migration 0045): posts the
 * missing Dr Inventory / Cr Accounts Payable transaction for any
 * Received GRN of this supplier that has none yet - covers GRNs that
 * were received before the automatic GRN-posting trigger (0043)
 * existed in this database. Idempotent: GRNs that already have a live
 * ledger transaction are left untouched and simply omitted from the
 * returned list.
 */
export async function repairSupplierGrnLedgerPostings(
  supplierId: string
): Promise<RepairedGrnPosting[]> {
  await assertPermission("accounts_payable_manage");

  const { data, error } = await supabase.rpc("repair_supplier_grn_ledger_postings", {
    p_supplier_id: supplierId,
  });

  if (error) {
    logError("[supplierPayments] repairSupplierGrnLedgerPostings failed:", error);
    throw toError(error);
  }

  return ((data ?? []) as RawRepairedGrnPosting[]).map((row) => ({
    grnId: row.grn_id,
    grnNumber: row.grn_number,
    amount: Number(row.amount),
    ledgerTransactionId: row.ledger_transaction_id,
  }));
}

export async function voidSupplierPayment(paymentId: string, reason?: string): Promise<void> {
  await assertPermission("accounts_payable_manage");

  const { error } = await supabase.rpc("void_supplier_payment", {
    p_payment_id: paymentId,
    p_reason: reason ?? null,
  });

  if (error) {
    logError("[supplierPayments] voidSupplierPayment failed:", error);
    throw toError(error);
  }
}
