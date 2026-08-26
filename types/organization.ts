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
 * One person's membership in a single branch - clinic_users.role here is
 * always one of the ordinary clinic roles (Owner/Admin/Dentist/
 * Receptionist) from lib/permissions.ts. Never a second permission
 * system - this is purely a read projection of existing clinic_users
 * rows across every branch of the organization.
 */
export interface OrganizationStaffBranch {
  clinic_id: string;
  clinic_name: string;
  role: string;
  status: string;
}

/**
 * One row per person in the organization roster (grouped by
 * auth_user_id), not one row per clinic_users record - the same person
 * can hold a different clinic role in each branch they belong to (e.g.
 * Dentist at Westlands, Admin at Parklands), so `branches` lists every
 * membership they hold.
 */
export interface OrganizationStaffMember {
  auth_user_id: string;
  full_name: string;
  email: string;
  organization_role: OrganizationRole;
  branches: OrganizationStaffBranch[];
}

/**
 * One row of the CEO's cross-branch invitation roster
 * (services/organizations.ts#getOrganizationInvitations) - a read
 * projection over the same `staff_invitations` table branch invitations
 * already live in (created via create_branch_invitation, migration
 * 0055), joined client-side with the branch name and inviter name.
 * `status` is derived, not stored - mirrors the existing
 * accepted_at/expires_at-based logic in PendingInvitationRow.tsx.
 */
export interface OrganizationInvitation {
  id: string;
  clinic_id: string;
  clinic_name: string;
  email: string;
  full_name: string;
  role: InvitableRole;
  invited_by_name: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

/**
 * services/organizations.ts#getOrganizationOverview - operational
 * (non-financial) rollup for the CEO Organization Dashboard. Deliberately
 * has no revenue/expense/P&L fields - consolidated financials are a
 * separate, later concern with their own no-fabrication accounting
 * rules, never folded into this headcount-style overview.
 */
export interface OrganizationBranchOverview {
  clinic_id: string;
  clinic_name: string;
  patients: number;
  appointments_today: number;
  staff: number;
}

export interface OrganizationOverview {
  branch_count: number;
  staff_count: number;
  patients_total: number;
  appointments_today_total: number;
  branches: OrganizationBranchOverview[];
}

/**
 * services/organizations.ts#getOrganizationFinancials - the CEO
 * Consolidated Financials view. FIN-1.5: Revenue/Direct Costs/Gross
 * Profit/Expenses/Net Profit come verbatim, per branch, from the general
 * ledger (services/ledger.ts#getProfitAndLossForClinics) - the same
 * canonical figures each branch's own Ledger P&L page shows for the same
 * period, summed across branches. EBIT/EBITDA come from the related but
 * genuinely distinct getEbitEbitdaForClinics() (EBIT excludes Interest/
 * Tax; EBITDA adds back Depreciation/Amortization) - not a second,
 * competing definition of Revenue/Gross Profit, since getEbitEbitda's own
 * Revenue/Direct Costs/Gross Profit are themselves read from the same
 * getProfitAndLoss() - just a further refinement kept as its own metric,
 * the same as on each branch's own Ledger pages.
 */
export interface OrganizationBranchFinancials {
  clinic_id: string;
  clinic_name: string;
  currency: string;
  revenue: number;
  directCosts: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  ebit: number;
  ebitdaAvailable: boolean;
  ebitda: number | null;
}

/**
 * currencyConsistent=false means at least two branches use a different
 * clinic_settings.currency - since this codebase has no FX conversion
 * anywhere, every blended (org-wide) field is zeroed/null in that case
 * and only the per-branch `branches` array (each in its own currency) is
 * populated. ebitdaAvailable/ebitdaBranchesIncluded/ebitdaBranchesTotal
 * disclose exactly how many of the org's branches actually contributed
 * to the consolidated EBITDA figure - a branch with no Depreciation/
 * Amortization account (the default for every clinic) is excluded, never
 * treated as a zero contribution.
 */
export interface OrganizationFinancials {
  currencyConsistent: boolean;
  currency: string | null;
  branchCurrencies: { clinic_id: string; clinic_name: string; currency: string }[];
  revenue: number;
  directCosts: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  expenses: number;
  netProfit: number;
  ebit: number;
  ebitdaAvailable: boolean;
  ebitdaBranchesIncluded: number;
  ebitdaBranchesTotal: number;
  ebitda: number | null;
  branches: OrganizationBranchFinancials[];
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
