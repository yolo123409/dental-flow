import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

export interface OrganizationPatientSearchResult {
  patient_id: string;
  clinic_id: string;
  clinic_name: string;
  first_name: string;
  last_name: string;
  phone: string | null;
}

/**
 * Cross-branch patient search, restricted server-side to the caller's
 * authorized branches (same get_organization_branch_ids() authorization
 * every other organization RPC uses) - kept separate from
 * organizationAnalytics.ts since it's query-driven, not date-range-driven.
 */
export async function searchOrganizationPatients(
  organizationId: string,
  query: string,
  limit = 10
): Promise<OrganizationPatientSearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const { data, error } = await supabase.rpc(
    "search_organization_patients",
    {
      p_organization_id: organizationId,
      p_query: query.trim(),
      p_limit: limit,
    }
  );

  if (error) {
    logError(
      "[organizationSearch] searchOrganizationPatients failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationPatientSearchResult[];
}
