import {
  OrganizationBranchAccess,
  OrganizationRole,
} from "@/types/organization";

export type InvitableOrganizationRole = Exclude<OrganizationRole, "CEO">;

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: InvitableOrganizationRole;
  branch_access: OrganizationBranchAccess;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreateOrganizationInvitationInput {
  email: string;
  role: InvitableOrganizationRole;
  branchAccess: OrganizationBranchAccess;
  branchIds?: string[];
}

export interface CreatedOrganizationInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

export interface OrganizationInvitationDetails {
  email: string;
  role: InvitableOrganizationRole;
  branch_access: OrganizationBranchAccess;
  organization_name: string;
  expires_at: string;
  accepted_at: string | null;
}
