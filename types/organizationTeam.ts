/**
 * Row shape returned by get_organization_team_roster - a union of two
 * disjoint populations (organization_users and locally-hired clinic_users,
 * see the RPC's own comment in supabase/migrations/0033_organization_team_access.sql
 * for exactly which rows are excluded and why). `role`/`status` are raw
 * values from whichever source table the row came from - CEO/Partner/
 * Manager/Viewer for "organization", Owner/Admin/Dentist/Receptionist for
 * "clinic" - never a new, unified enum.
 */
export type OrganizationTeamMemberSource = "organization" | "clinic";

export type OrganizationTeamMemberBranchScope = "all" | "selected" | "single";

export interface OrganizationTeamMember {
  member_key: string;
  source: OrganizationTeamMemberSource;

  organization_user_id: string | null;
  clinic_user_id: string | null;

  full_name: string;
  email: string;

  role: string;
  status: string;

  branch_scope: OrganizationTeamMemberBranchScope;
  branch_ids: string[];
  branch_names: string[];

  invited_by_name: string | null;

  created_at: string;
  total_count: number;
}

export interface OrganizationTeamRosterFilters {
  search?: string;
  role?: string;
  status?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
}
