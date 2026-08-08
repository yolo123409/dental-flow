import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

export type ProcurementDocumentType = "purchase_order" | "grn";

/**
 * Formats a concurrency-safe, per-clinic sequential document number via
 * the next_document_number RPC (a DB-side atomic counter, not the
 * client-side COUNT(*)+1 pattern services/billing.ts#generateInvoiceNumber
 * uses - that pattern has a real race condition and no DB uniqueness
 * backstop, deliberately not repeated here).
 */
export async function generateDocumentNumber(
  clinicId: string,
  documentType: ProcurementDocumentType,
  prefix: string
): Promise<string> {
  const { data, error } = await supabase.rpc("next_document_number", {
    p_clinic_id: clinicId,
    p_document_type: documentType,
  });

  if (error) {
    logError("[documentNumber] next_document_number failed:", error);

    throw toError(error);
  }

  return `${prefix}-${String(data).padStart(6, "0")}`;
}
