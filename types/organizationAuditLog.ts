/**
 * Mirrored 1:1 from organization_audit_log's `action` check constraint
 * (supabase/migrations/0033_organization_team_access.sql) so TS and SQL
 * can't silently drift - the same discipline OrganizationRole/
 * OrganizationUserStatus already apply to organization_users.
 */
export type OrganizationAuditAction =
  | "member_invited"
  | "invitation_resent"
  | "invitation_cancelled"
  | "invitation_accepted"
  | "member_role_changed"
  | "member_branches_changed"
  | "member_suspended"
  | "member_reactivated"
  | "member_removed"
  | "clinic_access_suspended"
  | "clinic_access_reactivated"
  | "clinic_access_removed"
  | "ownership_transferred";

export type OrganizationAuditTargetKind =
  | "organization_user"
  | "clinic_user"
  | "invitation";

export interface OrganizationAuditLogEntry {
  id: string;
  actor_full_name: string;
  actor_email: string;
  action: OrganizationAuditAction;
  target_kind: OrganizationAuditTargetKind;
  target_id: string | null;
  target_full_name: string | null;
  target_email: string;
  target_clinic_id: string | null;
  target_clinic_name: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  total_count: number;
}

export const AUDIT_ACTION_LABELS: Record<OrganizationAuditAction, string> = {
  member_invited: "invited",
  invitation_resent: "resent an invitation to",
  invitation_cancelled: "cancelled an invitation for",
  invitation_accepted: "joined the organization",
  member_role_changed: "changed the role of",
  member_branches_changed: "changed branch access for",
  member_suspended: "suspended",
  member_reactivated: "reactivated",
  member_removed: "removed",
  clinic_access_suspended: "suspended",
  clinic_access_reactivated: "reactivated",
  clinic_access_removed: "removed",
  ownership_transferred: "transferred ownership to",
};
