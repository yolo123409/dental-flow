import { InvitableRole } from "@/lib/permissions";

export interface StaffInvitation {
  id: string;
  clinic_id: string;
  email: string;
  full_name: string;
  role: InvitableRole;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreateInvitationInput {
  email: string;
  full_name: string;
  role: InvitableRole;
}

export interface CreatedInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

/**
 * Return shape of the existing, unmodified get_invitation_details(text)
 * RPC (migration 0008) - independent-clinic invitations only. Kept
 * byte-for-byte as it always was; see OrganizationInvitationDetails in
 * types/organization.ts for the separate branch-invitation shape.
 */
export interface InvitationDetails {
  email: string;
  role: InvitableRole;
  full_name: string;
  clinic_name: string;
  expires_at: string;
  accepted_at: string | null;
}
