import { InvitableRole } from "@/lib/permissions";

/**
 * Multi-branch organizations (migration 0055_organizations.sql). A
 * branch is an ordinary `clinics` row with `organization_id` set - these
 * types describe the thin organization layer on top, never a
 * replacement for clinic-scoped types (ClinicUser, etc.), which stay
 * exactly as they are for every branch and every independent clinic.
 */
export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

/**
 * 'CEO' is the only org-level capability (branch creation/management,
 * consolidated accounting). 'Member' covers everyone who has accepted a
 * branch invitation - it grants no org-level capability by itself; their
 * real permissions are entirely branch-scoped via clinic_users.role in
 * each branch they belong to, exactly like independent-clinic staff.
 */
export type OrganizationRole = "CEO" | "Member";

export interface OrganizationUser {
  id: string;
  organization_id: string;
  auth_user_id: string;
  role: OrganizationRole;
  // Server-persisted UX default for "which branch is currently
  // selected" - never a security boundary. NULL until a branch has been
  // resolved at least once.
  active_clinic_id: string | null;
  created_at: string;
}

export interface OrganizationBranch {
  id: string;
  name: string;
  organization_id: string;
  created_at: string;
}

/**
 * Return shape of get_organization_invitation_details(text) - a separate
 * RPC from get_invitation_details(text) (migration 0008), never a
 * modification of it (Postgres rejects changing an existing function's
 * return columns via CREATE OR REPLACE). Only ever returns a row for a
 * branch invitation (the invitation's clinic belongs to an
 * organization); returns no rows for an ordinary independent-clinic
 * invitation, which is the signal
 * services/staffInvitations.ts#acceptInvitation uses to pick the right
 * accept RPC.
 */
export interface OrganizationInvitationDetails {
  email: string;
  role: InvitableRole;
  full_name: string;
  clinic_name: string;
  organization_name: string;
  expires_at: string;
  accepted_at: string | null;
}
