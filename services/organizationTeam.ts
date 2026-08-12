import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import {
  OrganizationTeamMember,
  OrganizationTeamRosterFilters,
} from "@/types/organizationTeam";

/**
 * The unified Team & Access roster: organization_users (CEO/Partner/
 * Manager/Viewer) plus genuinely locally-hired clinic_users (Owner/Admin/
 * Dentist/Receptionist) across every branch in the organization, paginated
 * and searched server-side (get_organization_team_roster, migration 0033)
 * - never fetched in full and filtered client-side, per the Search
 * Performance requirement for orgs with 100+ members across 52 branches.
 * `total_count` is the same value on every returned row (a window
 * function's count(*) over()) - read it off row 0 for pagination UI.
 */
export async function getOrganizationTeamRoster(
  organizationId: string,
  filters: OrganizationTeamRosterFilters = {}
): Promise<{ members: OrganizationTeamMember[]; totalCount: number }> {
  const { data, error } = await supabase.rpc("get_organization_team_roster", {
    p_organization_id: organizationId,
    p_search: filters.search?.trim() || null,
    p_role: filters.role || null,
    p_status: filters.status || null,
    p_branch_id: filters.branchId || null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });

  if (error) {
    logError("[organizationTeam] getOrganizationTeamRoster failed:", error);

    throw toError(error);
  }

  const members = (data ?? []) as OrganizationTeamMember[];

  return {
    members,
    totalCount: members[0]?.total_count ?? 0,
  };
}

/**
 * Suspends/reactivates/removes a genuinely locally-hired clinic_users row
 * (organization_user_id is null) from the Team & Access page, with an
 * org-scoped audit trail - a parallel path to services/users.ts's
 * suspendUser/activateUser/deleteUser, not a replacement. The clinic Staff
 * page keeps using those functions unchanged.
 */
export async function suspendClinicUserForOrganization(
  clinicUserId: string
): Promise<void> {
  const { error } = await supabase.rpc(
    "suspend_clinic_user_for_organization",
    { p_clinic_user_id: clinicUserId }
  );

  if (error) {
    logError(
      "[organizationTeam] suspendClinicUserForOrganization failed:",
      error
    );

    throw toError(error);
  }
}

export async function reactivateClinicUserForOrganization(
  clinicUserId: string
): Promise<void> {
  const { error } = await supabase.rpc(
    "reactivate_clinic_user_for_organization",
    { p_clinic_user_id: clinicUserId }
  );

  if (error) {
    logError(
      "[organizationTeam] reactivateClinicUserForOrganization failed:",
      error
    );

    throw toError(error);
  }
}

export async function removeClinicUserForOrganization(
  clinicUserId: string
): Promise<void> {
  const { error } = await supabase.rpc(
    "remove_clinic_user_for_organization",
    { p_clinic_user_id: clinicUserId }
  );

  if (error) {
    logError(
      "[organizationTeam] removeClinicUserForOrganization failed:",
      error
    );

    throw toError(error);
  }
}
