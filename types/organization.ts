export type OrganizationRole = "CEO" | "Partner" | "Manager" | "Viewer";

export type OrganizationBranchAccess = "all" | "selected";

export type OrganizationUserStatus = "Active" | "Suspended" | "Removed";

export interface Organization {
  id: string;

  name: string;

  primary_owner_user_id: string;

  created_at: string;
  updated_at: string;
}

export interface OrganizationUser {
  id: string;

  organization_id: string;
  user_id: string;

  full_name: string;
  email: string;

  role: OrganizationRole;
  branch_access: OrganizationBranchAccess;
  status: OrganizationUserStatus;

  invited_by: string | null;

  created_at: string;
  updated_at: string;
}
