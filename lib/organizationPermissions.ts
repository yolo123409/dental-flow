import { OrganizationRole } from "@/types/organization";

export type OrganizationPermission =
  | "view_team"
  | "invite_member"
  | "edit_member"
  | "suspend_member"
  | "remove_member"
  | "view_audit_log";

/**
 * Mirrors lib/permissions.ts's shape for the organization level. Every
 * capability here is UI-gating only - the real enforcement is each RPC's
 * own is_organization_ceo() check (see migration 0033), exactly the same
 * relationship lib/permissions.ts already has to clinic-level RLS.
 *
 * Partner/Manager/Viewer/Dentist/Receptionist are deliberately [] - every
 * existing check in this codebase (RLS, RPCs, page gates) is CEO-only with
 * zero exceptions today, and nothing in this phase expands that. Dentist/
 * Receptionist branch invitees get their real, canonical permissions from
 * lib/permissions.ts once provisioned into a branch (migration 0047) - this
 * map is org-management-only (inviting/editing/suspending members) and
 * deliberately unrelated to that. Granting Partner specific capabilities
 * later is a one-line change to this map, not a redesign - but it also
 * requires loosening the corresponding RPCs' authorization, which this
 * phase does not do.
 */
const organizationPermissions: Record<
  OrganizationRole,
  OrganizationPermission[]
> = {
  CEO: [
    "view_team",
    "invite_member",
    "edit_member",
    "suspend_member",
    "remove_member",
    "view_audit_log",
  ],
  Partner: [],
  Manager: [],
  Viewer: [],
  Dentist: [],
  Receptionist: [],
};

export function canAccessOrganization(
  role: OrganizationRole,
  permission: OrganizationPermission
): boolean {
  return organizationPermissions[role].includes(permission);
}

/**
 * Codifies "the CEO retains ultimate authority" - no role, including the
 * CEO's own account, can suspend/remove/edit-role a CEO row (also
 * enforced, independently, by every relevant RPC and by
 * organization_users_update_ceo_only's RLS check).
 */
export function canActOnOrganizationMember(
  targetRole: OrganizationRole
): boolean {
  return targetRole !== "CEO";
}
