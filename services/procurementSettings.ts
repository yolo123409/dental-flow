import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

import { ProcurementSettings } from "@/types/procurement";

const DEFAULTS: Omit<ProcurementSettings, "clinic_id"> = {
  po_prefix: "PO",
  po_document_title: "Purchase Order",
  po_header_text: null,
  po_footer_text: null,
  po_default_notes: null,
  po_terms: null,
  po_signature_label: "Authorized By",
  po_custom_fields: [],
  grn_prefix: "GRN",
  grn_document_title: "Goods Received Note",
  grn_header_text: null,
  grn_footer_text: null,
  grn_visible_columns: {
    ordered: true,
    received: true,
    unit: true,
    unit_cost: true,
    batch: false,
    expiry: false,
  },
  grn_signature_label: "Received By",
  grn_custom_fields: [],
};

/**
 * Returns the clinic's procurement document settings, or in-memory
 * defaults if the clinic hasn't visited the settings page yet - no row
 * is created until updateProcurementSettings is actually called, so
 * document views work immediately without a forced setup step.
 */
export async function getProcurementSettings(): Promise<ProcurementSettings> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_procurement_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    logError("[procurementSettings] getProcurementSettings failed:", error);

    throw toError(error);
  }

  if (!data) {
    return { clinic_id: clinicId, ...DEFAULTS };
  }

  return data as ProcurementSettings;
}

export async function updateProcurementSettings(
  input: Partial<Omit<ProcurementSettings, "clinic_id">>
): Promise<void> {
  await assertPermission("procurement_manage");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase.from("clinic_procurement_settings").upsert(
    {
      clinic_id: clinicId,
      ...input,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );

  if (error) {
    logError(
      "[procurementSettings] updateProcurementSettings failed:",
      error
    );

    throw toError(error);
  }
}
