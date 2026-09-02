import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { assertPermission } from "./authorization";

export interface FinancialAuditLogEntry {
  id: string;
  clinic_id: string;
  table_name: string;
  record_id: string;
  action: "insert" | "update";
  actor_user_id: string | null;
  actor_clinic_user_id: string | null;
  actor_role: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Every logged mutation for a single financial record (an invoice, a
 * payment, a charge) - written by the generic _log_financial_audit_event
 * trigger (migration 0113), never by application code directly. Oldest
 * first, so a "History" view reads top-to-bottom as a real timeline.
 */
export async function getFinancialAuditLog(
  tableName: "clinic_invoices" | "clinic_payments" | "clinic_charges",
  recordId: string
): Promise<FinancialAuditLogEntry[]> {
  await assertPermission("ledger");

  const { data, error } = await supabase
    .from("financial_audit_log")
    .select("*")
    .eq("table_name", tableName)
    .eq("record_id", recordId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("[financialAuditLog] getFinancialAuditLog failed:", error);
    throw toError(error);
  }

  return (data ?? []) as FinancialAuditLogEntry[];
}
