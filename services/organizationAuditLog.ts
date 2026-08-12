import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { OrganizationAuditLogEntry } from "@/types/organizationAuditLog";

interface GetOrganizationAuditLogOptions {
  targetId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Paginated audit trail (get_organization_audit_log, migration 0033),
 * CEO-only. Pass targetId to scope it to one person - used by the Member
 * Detail panel's "Recent Activity" preview; omitted, it's the full
 * org-wide feed. Same total_count-on-every-row pagination convention as
 * getOrganizationTeamRoster.
 */
export async function getOrganizationAuditLog(
  organizationId: string,
  options: GetOrganizationAuditLogOptions = {}
): Promise<{ entries: OrganizationAuditLogEntry[]; totalCount: number }> {
  const { data, error } = await supabase.rpc("get_organization_audit_log", {
    p_organization_id: organizationId,
    p_target_id: options.targetId ?? null,
    p_limit: options.limit ?? 25,
    p_offset: options.offset ?? 0,
  });

  if (error) {
    logError("[organizationAuditLog] getOrganizationAuditLog failed:", error);

    throw toError(error);
  }

  const entries = (data ?? []) as OrganizationAuditLogEntry[];

  return {
    entries,
    totalCount: entries[0]?.total_count ?? 0,
  };
}
