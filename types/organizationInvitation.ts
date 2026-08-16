import {
  OrganizationBranchAccess,
  OrganizationRole,
} from "@/types/organization";

export type InvitableOrganizationRole = Exclude<OrganizationRole, "CEO">;

/**
 * Single source of truth for which roles the invite/edit-member UI offers -
 * mirrors what create_organization_invitation/update_organization_member
 * actually accept (migration 0047). Dentist/Receptionist resolve to the
 * exact same lib/permissions.ts permission set an independent clinic's own
 * Dentist/Receptionist gets (see switch_active_branch, 0047) - Owner/CEO
 * are never offered here, matching every existing invite path.
 */
export const INVITABLE_ORGANIZATION_ROLES: InvitableOrganizationRole[] = [
  "Partner",
  "Manager",
  "Viewer",
  "Dentist",
  "Receptionist",
];

/**
 * "not_configured" means RESEND_API_KEY isn't set - a distinct, honest
 * state from "failed" (a real send attempt that errored). Never a fourth
 * "sent" claim when either of the other two is true - see
 * lib/email/resend.ts.
 */
export type EmailDeliveryStatus = "sent" | "failed" | "not_configured";

/**
 * Shape returned by get_organization_pending_invitations (migration 0036)
 * - resolved server-side (inviter name, branch names) rather than N+1
 * client calls. full_name is the inviter's hint, not authoritative - the
 * invitee still confirms/can override it at accept time.
 */
export interface OrganizationInvitation {
  id: string;
  email: string;
  full_name: string | null;
  message: string | null;
  role: InvitableOrganizationRole;
  branch_access: OrganizationBranchAccess;
  branch_names: string[];
  token: string;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
  is_expired: boolean;
  /**
   * True when this invitation resulted in a server-created auth account
   * with a generated temporary password (migration 0037), still awaiting
   * that account's first login. False for invitations to an email that
   * already had an account (they sign in with existing credentials) and
   * for any invitation created before this migration.
   */
  credentials_issued: boolean;
  email_status: EmailDeliveryStatus;
  email_error: string | null;
}

export interface CreateOrganizationInvitationInput {
  fullName: string;
  email: string;
  role: InvitableOrganizationRole;
  branchAccess: OrganizationBranchAccess;
  branchIds?: string[];
  message?: string;
  /** Needed for the invitation email's content - not stored anywhere new. */
  organizationName: string;
  /** Resolved branch names for 'selected' access; empty for 'all' (the email shows "All Branches"). */
  branchNames: string[];
}

export interface CreatedOrganizationInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

export interface IssuedCredentials {
  email: string;
  temporaryPassword: string;
}

/**
 * Result of app/api/organization-invitations (POST). "new_account" means a
 * fresh auth account was created with a temporary password (shown exactly
 * once, never retrievable again); "existing_account" means the invited
 * email already had a DentalFlow account - no password was generated or
 * changed, the existing sign-in-and-join flow applies.
 */
export type CreateOrganizationInvitationResult =
  | {
      mode: "new_account";
      invitation: CreatedOrganizationInvitation;
      credentials: IssuedCredentials;
      link: string;
      emailStatus: EmailDeliveryStatus;
      emailError?: string;
    }
  | {
      mode: "existing_account";
      invitation: CreatedOrganizationInvitation;
      link: string;
      emailStatus: EmailDeliveryStatus;
      emailError?: string;
    };

/**
 * Result of app/api/organization-invitations/[id]/resend (POST).
 * "new_account" means the not-yet-activated temporary credential was
 * rotated (the previous one is now dead, and can never be shown again);
 * "link_only" covers existing-account invitations and any invitation whose
 * account already completed its first login - resend behaves as it always
 * has, just a refreshed link.
 */
export type ResendOrganizationInvitationResult =
  | {
      mode: "new_account";
      credentials: IssuedCredentials;
      link: string;
      emailStatus: EmailDeliveryStatus;
      emailError?: string;
    }
  | {
      mode: "link_only";
      link: string;
      emailStatus: EmailDeliveryStatus;
      emailError?: string;
    };

export interface OrganizationInvitationDetails {
  email: string;
  role: InvitableOrganizationRole;
  branch_access: OrganizationBranchAccess;
  organization_name: string;
  expires_at: string;
  accepted_at: string | null;
  full_name: string | null;
  message: string | null;
}
