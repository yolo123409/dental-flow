import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { getCurrentClinicId } from "./clinic";

import { InsuranceProvider } from "@/types/insurance";

/**
 * The full master list of insurance providers (active only) - used to
 * populate the searchable checklist during onboarding, in Settings, and
 * in the invoice screen's quick-add modal.
 */
export async function getInsuranceProviders(): Promise<
  InsuranceProvider[]
> {
  const { data, error } = await supabase
    .from("insurance_providers")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    logError("[insurance] getInsuranceProviders failed:", error);

    throw toError(error);
  }

  return (data ?? []) as InsuranceProvider[];
}

/**
 * The providers a specific clinic currently accepts - used to populate
 * an invoice's Insurance Provider dropdown (never the full master list,
 * per spec section 8). Defaults to the caller's own active clinic when
 * clinicId is omitted.
 */
export async function getClinicInsuranceProviders(
  clinicId?: string
): Promise<InsuranceProvider[]> {
  const resolvedClinicId = clinicId ?? (await getCurrentClinicId());

  const { data, error } = await supabase
    .from("clinic_insurance_providers")
    .select("insurance_providers(id, name, active, created_at)")
    .eq("clinic_id", resolvedClinicId);

  if (error) {
    logError(
      "[insurance] getClinicInsuranceProviders failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? [])
    .map((row) => row.insurance_providers as unknown as InsuranceProvider)
    .filter((provider): provider is InsuranceProvider => Boolean(provider))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Syncs a clinic's accepted-insurer list to exactly providerIds. Inserts
 * the newly-checked providers first, then deletes the newly-unchecked
 * ones (not delete-then-insert) - if the two calls don't complete as a
 * unit (network drop, closed tab), this ordering leaves the clinic with
 * a temporary superset of old and new providers rather than a moment
 * with none accepted at all. RLS (Owner/Admin only) is the real
 * enforcement here; this function has no role check of its own.
 */
export async function updateClinicInsuranceProviders(
  clinicId: string,
  providerIds: string[]
): Promise<void> {
  const { data: existingRows, error: existingError } = await supabase
    .from("clinic_insurance_providers")
    .select("insurance_provider_id")
    .eq("clinic_id", clinicId);

  if (existingError) {
    logError(
      "[insurance] updateClinicInsuranceProviders (load current) failed:",
      existingError
    );

    throw toError(existingError);
  }

  const current = (existingRows ?? []).map(
    (row) => row.insurance_provider_id as string
  );

  const toAdd = providerIds.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !providerIds.includes(id));

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("clinic_insurance_providers")
      .insert(
        toAdd.map((insuranceProviderId) => ({
          clinic_id: clinicId,
          insurance_provider_id: insuranceProviderId,
        }))
      );

    if (insertError) {
      logError(
        "[insurance] updateClinicInsuranceProviders (insert) failed:",
        insertError
      );

      throw toError(insertError);
    }
  }

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("clinic_insurance_providers")
      .delete()
      .eq("clinic_id", clinicId)
      .in("insurance_provider_id", toRemove);

    if (deleteError) {
      logError(
        "[insurance] updateClinicInsuranceProviders (delete) failed:",
        deleteError
      );

      throw toError(deleteError);
    }
  }
}
