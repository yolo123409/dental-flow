import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { runExclusive } from "@/lib/inFlightGuard";
import { generateToken } from "@/lib/generateToken";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { InvitableRole } from "@/lib/permissions";
import { computeEbitEbitdaFromPL, getProfitAndLossForClinics } from "./ledger";
import { getCurrentClinicUser } from "./clinicUsers";
import { sendInvitationEmail } from "./invitationEmail";

import {
  OrganizationUser,
  OrganizationBranch,
  OrganizationInvitationDetails,
  OrganizationRole,
  OrganizationStaffMember,
  OrganizationInvitation,
  OrganizationOverview,
  OrganizationBranchOverview,
  OrganizationFinancials,
  OrganizationBranchFinancials,
} from "@/types/organization";

/* -------------------------------------- */
/* Branch invitations - lookup            */
/* -------------------------------------- */

/**
 * Public (no clinic/org session required) - the token itself is the
 * credential, same convention as get_invitation_details. Calls the
 * SEPARATE get_organization_invitation_details RPC (migration 0055),
 * which only ever returns a row for a branch invitation and returns no
 * rows for an ordinary independent-clinic one - that's the signal
 * services/staffInvitations.ts#acceptInvitation uses to pick the right
 * accept RPC, tried before falling back to the original, unmodified
 * get_invitation_details.
 */
export async function getOrganizationInvitationDetails(
  token: string
): Promise<OrganizationInvitationDetails | null> {
  const { data, error } = await supabase.rpc(
    "get_organization_invitation_details",
    { p_token: token }
  );

  if (error) {
    logError(
      "[organizations] getOrganizationInvitationDetails failed:",
      error
    );

    throw toError(error);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0] as OrganizationInvitationDetails;
}

/* -------------------------------------- */
/* Current organization membership        */
/* -------------------------------------- */

/**
 * Null for every independent-clinic user (the overwhelmingly common
 * case) - a cheap query that returns zero rows for them, never an error.
 * Only multi-branch organization members (CEO or Member) ever get a row
 * back. See services/clinicUsers.ts#getCurrentClinicUser, the one place
 * this is used to resolve which of a multi-branch user's several
 * clinic_users rows is "current".
 */
/**
 * Guards the organization-WIDE aggregate reads below (every branch's
 * financials/overview/staff roster/invitations at once) - a plain
 * Member legitimately has a real organization_users row (so
 * getCurrentOrganizationUser() itself is never restricted), but only a
 * CEO should be able to pull data spanning every branch in one call,
 * matching CeoGuard's own isCeo check on the pages that call these
 * (organization/dashboard, /financials, /staff, /invitations). Defined
 * here rather than in services/authorization.ts to avoid a circular
 * import - assertPermission() there depends on services/clinicUsers.ts,
 * which itself depends on this file's getCurrentOrganizationUser().
 */
async function assertOrganizationCeo(): Promise<void> {
  const organizationUser = await getCurrentOrganizationUser();

  if (!organizationUser || organizationUser.role !== "CEO") {
    throw new Error("Only the organization CEO can perform this action.");
  }
}

export async function getCurrentOrganizationUser(): Promise<OrganizationUser | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    logError("[organizations] Failed to get auth user:", authError);

    throw toError(authError);
  }

  if (!user) return null;

  const { data, error } = await supabase
    .from("organization_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    logError("[organizations] getCurrentOrganizationUser failed:", error);

    throw toError(error);
  }

  return data as OrganizationUser | null;
}

/* -------------------------------------- */
/* Branches                               */
/* -------------------------------------- */

/**
 * Every branch of `organizationId` the CURRENT user actually has
 * clinic-level access to. RLS on `clinics` (unmodified - see migration
 * 0055's header) restricts this automatically: a CEO holds a
 * clinic_users row in every branch they've created or been granted, so
 * this naturally returns every branch for a CEO, and only the specific
 * branches a Member has actually been added to for everyone else.
 */
export async function getOrganizationBranches(
  organizationId: string
): Promise<OrganizationBranch[]> {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, organization_id, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("[organizations] getOrganizationBranches failed:", error);

    throw toError(error);
  }

  return (data ?? []) as OrganizationBranch[];
}

/* -------------------------------------- */
/* Organization-wide staff roster         */
/* -------------------------------------- */

/**
 * Every person who holds a clinic_users row in any branch of
 * `organizationId`, grouped by auth_user_id so a person who belongs to
 * several branches (with possibly different clinic roles in each)
 * appears once, with all of their branch memberships listed. Relies
 * entirely on the existing clinic_users RLS policy
 * (clinic_users_select_own_clinic_staff_admins, migration 0008): the
 * caller can only see clinic_users rows for branches where they
 * themselves are Owner/Admin, which for a CEO is every branch in their
 * organization (create_branch always makes the CEO Owner of any branch
 * they create) - no new policy needed for this read.
 */
export async function getOrganizationStaff(
  organizationId: string
): Promise<OrganizationStaffMember[]> {
  await assertOrganizationCeo();

  const branches = await getOrganizationBranches(organizationId);

  const branchIds = branches.map((branch) => branch.id);

  if (branchIds.length === 0) {
    return [];
  }

  const branchNameById = new Map(
    branches.map((branch) => [branch.id, branch.name])
  );

  // clinic_users paged rather than a single unbounded fetch - one row
  // per staff-per-branch membership across up to 50 branches, which can
  // plausibly cross 1,000 for a large organization and would otherwise
  // silently drop staff from this list with no error. organization_users
  // has at most one row per person org-wide, inherently bounded by
  // realistic staff counts - left as a plain fetch.
  let clinicUsersRows: {
    auth_user_id: string;
    full_name: string;
    email: string;
    role: string;
    status: string;
    clinic_id: string;
  }[];

  const organizationUsersResult = await supabase
    .from("organization_users")
    .select("auth_user_id, role")
    .eq("organization_id", organizationId);

  try {
    clinicUsersRows = await fetchAllRows((from, to) =>
      supabase
        .from("clinic_users")
        .select("auth_user_id, full_name, email, role, status, clinic_id")
        .in("clinic_id", branchIds)
        .order("clinic_id")
        .range(from, to)
    );
  } catch (error) {
    logError(
      "[organizations] getOrganizationStaff failed to load clinic_users:",
      error
    );

    throw error;
  }

  if (organizationUsersResult.error) {
    logError(
      "[organizations] getOrganizationStaff failed to load organization_users:",
      organizationUsersResult.error
    );

    throw toError(organizationUsersResult.error);
  }

  const organizationRoleByAuthUserId = new Map(
    (organizationUsersResult.data ?? []).map((row) => [
      row.auth_user_id as string,
      row.role as OrganizationRole,
    ])
  );

  const staffByAuthUserId = new Map<string, OrganizationStaffMember>();

  for (const row of clinicUsersRows) {
    const branchEntry = {
      clinic_id: row.clinic_id as string,
      clinic_name:
        branchNameById.get(row.clinic_id as string) ?? "Unknown branch",
      role: row.role as string,
      status: row.status as string,
    };

    const existing = staffByAuthUserId.get(row.auth_user_id as string);

    if (existing) {
      existing.branches.push(branchEntry);
    } else {
      staffByAuthUserId.set(row.auth_user_id as string, {
        auth_user_id: row.auth_user_id as string,
        full_name: row.full_name as string,
        email: row.email as string,
        organization_role:
          organizationRoleByAuthUserId.get(row.auth_user_id as string) ??
          "Member",
        branches: [branchEntry],
      });
    }
  }

  const staff = Array.from(staffByAuthUserId.values());

  for (const member of staff) {
    member.branches.sort((a, b) =>
      a.clinic_name.localeCompare(b.clinic_name)
    );
  }

  staff.sort((a, b) => {
    if (a.organization_role !== b.organization_role) {
      return a.organization_role === "CEO" ? -1 : 1;
    }

    return a.full_name.localeCompare(b.full_name);
  });

  return staff;
}

/* -------------------------------------- */
/* Organization dashboard (operational)   */
/* -------------------------------------- */

/**
 * Operational (non-financial) rollup for the CEO Organization Dashboard -
 * branch/staff counts and today's activity, per branch and org-wide.
 * Deliberately excludes revenue/expenses/any accounting figure:
 * consolidated financials are a separate, later feature with their own
 * strict no-fabrication aggregation rules, never mixed into this
 * headcount-style overview. Mirrors services/dashboard.ts#getDashboardStats'
 * exact count-query pattern (count: "exact", head: true), just run once
 * per branch instead of once for the caller's single active clinic.
 */
export async function getOrganizationOverview(
  organizationId: string
): Promise<OrganizationOverview> {
  await assertOrganizationCeo();

  const branches = await getOrganizationBranches(organizationId);

  if (branches.length === 0) {
    return {
      branch_count: 0,
      staff_count: 0,
      patients_total: 0,
      appointments_today_total: 0,
      branches: [],
    };
  }

  const today = new Date().toISOString().split("T")[0];
  const branchIds = branches.map((branch) => branch.id);

  // ONE aggregate RPC (migration 0065) instead of fetching one row per
  // patient/appointment and counting client-side - that row-fetching
  // approach (a production-hardening fix earlier in this same pass,
  // replacing an N-branch count-query loop) was found during the Part 2
  // 50-branch scale test to silently truncate at PostgREST's default
  // 1,000-row response cap once total patients/appointments across all
  // branches crossed that number, undercounting with no error at all.
  // get_organization_branch_counts returns one row PER BRANCH (pre-
  // aggregated in SQL), never per patient/appointment, so it can't hit
  // that cap at any realistic organization size.
  const [countsResult, staff] = await Promise.all([
    supabase.rpc("get_organization_branch_counts", {
      p_clinic_ids: branchIds,
      p_today: today,
    }),
    getOrganizationStaff(organizationId),
  ]);

  if (countsResult.error) {
    logError(
      "[organizations] getOrganizationOverview failed to load branch counts:",
      countsResult.error
    );

    throw toError(countsResult.error);
  }

  const patientCountByBranch = new Map<string, number>();
  const appointmentCountByBranch = new Map<string, number>();

  for (const row of countsResult.data ?? []) {
    patientCountByBranch.set(row.clinic_id, Number(row.patient_count));
    appointmentCountByBranch.set(
      row.clinic_id,
      Number(row.appointments_today_count)
    );
  }

  const branchCounts = branches.map((branch) => ({
    clinic_id: branch.id,
    clinic_name: branch.name,
    patients: patientCountByBranch.get(branch.id) ?? 0,
    appointments_today: appointmentCountByBranch.get(branch.id) ?? 0,
  }));

  const staffCountByBranch = new Map<string, number>();

  for (const member of staff) {
    for (const branch of member.branches) {
      staffCountByBranch.set(
        branch.clinic_id,
        (staffCountByBranch.get(branch.clinic_id) ?? 0) + 1
      );
    }
  }

  const branchOverviews: OrganizationBranchOverview[] = branchCounts.map(
    (branch) => ({
      ...branch,
      staff: staffCountByBranch.get(branch.clinic_id) ?? 0,
    })
  );

  return {
    branch_count: branches.length,
    staff_count: staff.length,
    patients_total: branchOverviews.reduce(
      (sum, branch) => sum + branch.patients,
      0
    ),
    appointments_today_total: branchOverviews.reduce(
      (sum, branch) => sum + branch.appointments_today,
      0
    ),
    branches: branchOverviews,
  };
}

/* -------------------------------------- */
/* Organization dashboard (financials)    */
/* -------------------------------------- */

/**
 * Consolidated Revenue/Direct Costs/Gross Profit/Expenses/Net Profit +
 * EBIT/EBITDA across every branch of the organization, for the CEO
 * Consolidated Financials view. Deliberately excludes Balance Sheet, Cash
 * Flow, AR/AP, financial ratios, stock days, and break-even - none of
 * those are safe to naively sum or average across branches, and are left
 * for a dedicated, separately-reviewed pass rather than being rushed
 * here.
 *
 * FIN-1.5: every P&L figure (Revenue, Direct Costs, Gross Profit,
 * Operating Expenses, Net Profit) is now read verbatim, per branch, from
 * getProfitAndLossForClinics() (services/ledger.ts) - the same batched
 * multi-clinic ledger primitive already used for EBIT/EBITDA below - and
 * summed across branches. Nothing here recomputes revenue, cost, or
 * profit; this function only fetches the canonical per-clinic ledger
 * results and adds them up.
 *
 * Before FIN-1.5, Revenue/Expenses came from getRevenueTotalsByClinic /
 * getPaidExpenseTotalsByClinic (a "Paid invoices" / "Paid clinic_expenses"
 * basis) and Direct Costs came from getTreatmentProfitabilityForClinics's
 * manually-configured clinic_treatments.direct_cost estimate, with Gross
 * Profit/Net Profit recomputed from those - the same non-ledger formula
 * services/reports/shared.ts#getPeriodFinancials used before FIN-1, batched
 * for multi-branch performance. That meant this page could disagree with
 * the now-canonical per-branch ledger P&L a CEO would see by visiting each
 * branch's own Ledger page (see the FIN-1 audit's "remaining known
 * inconsistency"). getProfitAndLossForClinics() is already a single
 * batched RPC round trip regardless of branch count (migration 0066), so
 * this fix does not reintroduce the original per-branch N+1 query problem
 * that motivated the batched functions in the first place - it simply
 * points at the correct canonical primitive instead of an independent one.
 *
 * EBIT/EBITDA remain a deliberately separate calculation from
 * getEbitEbitdaForClinics() - not a second, competing definition of
 * Revenue/Gross Profit (getEbitEbitda's own Revenue/Direct Costs/Gross
 * Profit are themselves read verbatim from the same getProfitAndLoss(),
 * per its own doc comment), but a genuinely distinct metric (EBIT excludes
 * Interest/Tax; EBITDA adds back Depreciation/Amortization) that this page
 * has always correctly kept separate from Net Profit, exactly as each
 * branch's own Ledger pages do.
 *
 * Currency safety: every branch's clinic_settings.currency is checked
 * before any blended total is computed. If branches don't all share one
 * currency, every blended field is zeroed/null - only the per-branch
 * `branches` array (each correctly labeled with its own currency) is
 * still populated, since per-branch figures never require summing. There
 * is no FX conversion anywhere in this codebase, so silently summing
 * mismatched currencies would be fabrication.
 *
 * EBITDA safety: a branch whose Chart of Accounts has no Depreciation/
 * Amortization account (the default for every clinic) reports
 * ebitdaAvailable=false - such branches are excluded from the
 * consolidated EBITDA sum (never treated as a zero contribution), and
 * ebitdaBranchesIncluded/ebitdaBranchesTotal disclose exactly how many
 * branches actually contributed, so a partial total is never presented
 * as complete.
 */
export async function getOrganizationFinancials(
  organizationId: string,
  start: Date,
  end: Date
): Promise<OrganizationFinancials> {
  await assertOrganizationCeo();

  const branches = await getOrganizationBranches(organizationId);

  if (branches.length === 0) {
    return {
      currencyConsistent: true,
      currency: null,
      branchCurrencies: [],
      revenue: 0,
      directCosts: 0,
      grossProfit: 0,
      grossMarginPercent: null,
      expenses: 0,
      netProfit: 0,
      ebit: 0,
      ebitdaAvailable: false,
      ebitdaBranchesIncluded: 0,
      ebitdaBranchesTotal: 0,
      ebitda: null,
      branches: [],
    };
  }

  const branchIds = branches.map((branch) => branch.id);

  const { data: settingsRows, error: settingsError } = await supabase
    .from("clinic_settings")
    .select("clinic_id, currency")
    .in("clinic_id", branchIds);

  if (settingsError) {
    logError(
      "[organizations] getOrganizationFinancials failed to load branch currencies:",
      settingsError
    );

    throw toError(settingsError);
  }

  const currencyByClinicId = new Map(
    (settingsRows ?? []).map((row) => [
      row.clinic_id as string,
      (row.currency as string) || "KES",
    ])
  );

  const branchCurrencies = branches.map((branch) => ({
    clinic_id: branch.id,
    clinic_name: branch.name,
    currency: currencyByClinicId.get(branch.id) ?? "KES",
  }));

  const currencyConsistent =
    new Set(branchCurrencies.map((branch) => branch.currency)).size <= 1;

  // Batched to one query/RPC round trip across every branch (migration
  // 0066), regardless of branch count - the same batching principle the
  // pre-FIN-1.5 implementation already established for this page, just
  // pointed at the canonical primitive. EBIT/EBITDA is derived from this
  // same P&L map via computeEbitEbitdaFromPL() rather than calling
  // getEbitEbitdaForClinics() (which would redundantly re-fetch the exact
  // same P&L data a second time) - found while auditing this page's query
  // count for FIN-3.10 at 47-branch scale. Reuses the exact same
  // per-clinic computation the single-clinic getEbitEbitda uses (see its
  // own doc comment in ledger.ts) - only how the underlying rows are
  // fetched changed, never the arithmetic.
  const profitAndLossByClinic = await getProfitAndLossForClinics(branchIds, start, end);

  const ebitEbitdaByClinic = new Map(
    Array.from(profitAndLossByClinic.entries()).map(([clinicId, pl]) => [
      clinicId,
      computeEbitEbitdaFromPL(pl),
    ])
  );

  const branchFinancials: OrganizationBranchFinancials[] = branches.map(
    (branch) => {
      const pl = profitAndLossByClinic.get(branch.id);
      const ebitEbitda = ebitEbitdaByClinic.get(branch.id);

      return {
        clinic_id: branch.id,
        clinic_name: branch.name,
        currency: currencyByClinicId.get(branch.id) ?? "KES",
        revenue: pl?.revenue.total ?? 0,
        directCosts: pl?.directCosts.total ?? 0,
        grossProfit: pl?.grossProfit ?? 0,
        expenses: pl?.totalOperatingExpenses ?? 0,
        netProfit: pl?.netProfit ?? 0,
        ebit: ebitEbitda?.ebit ?? 0,
        ebitdaAvailable: ebitEbitda?.ebitdaAvailable ?? false,
        ebitda: ebitEbitda?.ebitda ?? null,
      };
    }
  );

  if (!currencyConsistent) {
    return {
      currencyConsistent: false,
      currency: null,
      branchCurrencies,
      revenue: 0,
      directCosts: 0,
      grossProfit: 0,
      grossMarginPercent: null,
      expenses: 0,
      netProfit: 0,
      ebit: 0,
      ebitdaAvailable: false,
      ebitdaBranchesIncluded: 0,
      ebitdaBranchesTotal: branchFinancials.length,
      ebitda: null,
      branches: branchFinancials,
    };
  }

  const revenue = branchFinancials.reduce((sum, branch) => sum + branch.revenue, 0);
  const directCosts = branchFinancials.reduce((sum, branch) => sum + branch.directCosts, 0);
  const grossProfit = branchFinancials.reduce((sum, branch) => sum + branch.grossProfit, 0);
  const expenses = branchFinancials.reduce((sum, branch) => sum + branch.expenses, 0);
  const netProfit = branchFinancials.reduce((sum, branch) => sum + branch.netProfit, 0);
  const ebit = branchFinancials.reduce((sum, branch) => sum + branch.ebit, 0);

  const ebitdaBranches = branchFinancials.filter(
    (branch) => branch.ebitdaAvailable && branch.ebitda !== null
  );

  const ebitdaAvailable = ebitdaBranches.length > 0;

  const ebitda = ebitdaAvailable
    ? ebitdaBranches.reduce((sum, branch) => sum + (branch.ebitda ?? 0), 0)
    : null;

  return {
    currencyConsistent: true,
    currency: branchCurrencies[0]?.currency ?? "KES",
    branchCurrencies,
    revenue,
    directCosts,
    grossProfit,
    grossMarginPercent: revenue > 0 ? (grossProfit / revenue) * 100 : null,
    expenses,
    netProfit,
    ebit,
    ebitdaAvailable,
    ebitdaBranchesIncluded: ebitdaBranches.length,
    ebitdaBranchesTotal: branchFinancials.length,
    ebitda,
    branches: branchFinancials,
  };
}

/* -------------------------------------- */
/* Onboarding: multi-branch organization  */
/* -------------------------------------- */

export interface CreateOrganizationWithCeoInput {
  organizationName: string;
  branchName: string;
  fullName: string;
  email: string;
  phone?: string;
}

export interface CreatedOrganization {
  organization_id: string;
  clinic_id: string;
  clinic_user_id: string;
}

export async function createOrganizationWithCeo(
  input: CreateOrganizationWithCeoInput
): Promise<CreatedOrganization> {
  const { data, error } = await supabase.rpc(
    "create_organization_with_ceo",
    {
      p_organization_name: input.organizationName,
      p_branch_name: input.branchName,
      p_owner_full_name: input.fullName,
      p_owner_email: input.email,
      p_owner_phone: input.phone ?? null,
    }
  );

  if (error) {
    logError("[organizations] createOrganizationWithCeo failed:", error);

    throw toError(error);
  }

  return data[0] as CreatedOrganization;
}

/**
 * Mirrors services/clinic.ts#provisionPendingClinicIfNeeded, but for the
 * Multi-Branch Organization onboarding path - handles the same
 * deferred-session gap (email confirmation required, so the signup
 * form's own signUp() call has no immediate session to provision with).
 * Called both right after MultiBranchSignupForm's signUp() and from
 * AuthContext.loadProfile. Safe to call more than once for the same
 * user - getCurrentOrganizationUser() is the idempotency check, exactly
 * parallel to how provisionPendingClinicIfNeeded checks for an existing
 * clinic_users row.
 */
export async function provisionPendingOrganizationIfNeeded(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Same in-tab race as services/clinic.ts#provisionPendingClinicIfNeeded:
  // MultiBranchSignupForm's own direct call and AuthContext's call can
  // both fire for the same freshly-signed-in user at once. Sharing the
  // same in-flight guard collapses the second caller onto the first's
  // result instead of letting both run the check-then-create RPC.
  return runExclusive(`provision-organization:${user.id}`, async () => {
    const pendingOrganizationName = user.user_metadata
      ?.pending_organization_name as string | undefined;

    const pendingBranchName = user.user_metadata
      ?.pending_branch_name as string | undefined;

    const pendingFullName = user.user_metadata
      ?.pending_full_name as string | undefined;

    if (!pendingOrganizationName || !pendingBranchName || !pendingFullName) {
      return false;
    }

    const existing = await getCurrentOrganizationUser();

    if (existing) {
      return false;
    }

    try {
      await createOrganizationWithCeo({
        organizationName: pendingOrganizationName,
        branchName: pendingBranchName,
        fullName: pendingFullName,
        email: user.email ?? "",
      });
    } catch (error) {
      // A concurrent call from a different tab/device may have already
      // created it - that's a benign race, not a real failure, so don't
      // surface it. Both of create_organization_with_ceo's own
      // precondition errors are covered, matching its exact wording.
      const message =
        error instanceof Error ? error.message : String(error);

      if (
        message.includes("already linked") ||
        message.includes("already belongs to an organization")
      ) {
        return false;
      }

      throw error;
    }

    return true;
  });
}

/* -------------------------------------- */
/* Branch creation (CEO only)             */
/* -------------------------------------- */

export async function createBranch(branchName: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_branch", {
    p_branch_name: branchName,
  });

  if (error) {
    logError("[organizations] createBranch failed:", error);

    throw toError(error);
  }

  return data[0].clinic_id as string;
}

/* -------------------------------------- */
/* Branch invitations (CEO)               */
/* -------------------------------------- */

export interface CreateBranchInvitationInput {
  email: string;
  full_name: string;
  role: InvitableRole;
}

function buildInviteLink(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  return `${origin}/invite/${token}`;
}

/**
 * Invites someone to a SPECIFIC branch, chosen explicitly by the caller
 * (p_clinic_id) rather than inferred from "whichever clinic is currently
 * active" - lets a CEO invite to any branch they own without first
 * switching into it. Wraps create_branch_invitation (migration 0055), a
 * function entirely separate from the independent-clinic
 * create_staff_invitation - never merged, never shared logic beyond the
 * staff_invitations table both happen to write to.
 */
export async function createBranchInvitation(
  clinicId: string,
  input: CreateBranchInvitationInput
): Promise<{
  invitationId: string;
  token: string;
  expiresAt: string;
  link: string;
  emailSent: boolean;
}> {
  const token = generateToken();

  const { data, error } = await supabase.rpc(
    "create_branch_invitation",
    {
      p_clinic_id: clinicId,
      p_email: input.email.trim(),
      p_full_name: input.full_name.trim(),
      p_role: input.role,
      p_token: token,
    }
  );

  if (error) {
    logError("[organizations] createBranchInvitation failed:", error);

    throw toError(error);
  }

  const result = data[0] as {
    invitation_id: string;
    token: string;
    expires_at: string;
  };

  // Best-effort inviter name for the email's "Invited by" line only -
  // never used for authorization (the RPC above already did every real
  // check). A failure here must never fail invitation creation, which
  // has already succeeded by this point.
  const inviterName = await getCurrentClinicUser()
    .then(
      (clinicUser) => (clinicUser?.full_name as string | undefined) ?? null
    )
    .catch(() => null);

  const emailSent = await sendInvitationEmail(result.token, inviterName);

  return {
    invitationId: result.invitation_id,
    token: result.token,
    expiresAt: result.expires_at,
    link: buildInviteLink(result.token),
    emailSent,
  };
}

/**
 * Every pending/accepted/expired invitation across every branch of
 * `organizationId`, for the CEO's organization-wide invitations view -
 * so they don't have to switch into each branch individually just to
 * see who's been invited where. Relies on the same
 * clinic_users_select_own_clinic_staff_admins-backed access a CEO
 * already has to every branch's clinic_users (see
 * getOrganizationStaff) - staff_invitations' own select policy is the
 * identical shape (`is_clinic_owner_or_admin(staff_invitations.clinic_id)`),
 * so no new grant is needed here either.
 */
export async function getOrganizationInvitations(
  organizationId: string
): Promise<OrganizationInvitation[]> {
  await assertOrganizationCeo();

  const branches = await getOrganizationBranches(organizationId);

  const branchIds = branches.map((branch) => branch.id);

  if (branchIds.length === 0) {
    return [];
  }

  const branchNameById = new Map(
    branches.map((branch) => [branch.id, branch.name])
  );

  // Paged rather than a single unbounded fetch - staff_invitations
  // accumulates every invitation ever sent (not just pending ones)
  // across up to 50 branches, which can plausibly cross 1,000 for a
  // long-lived large organization and would otherwise silently drop
  // invitations from this list with no error.
  let invitations: {
    id: string;
    clinic_id: string;
    email: string;
    full_name: string;
    role: string;
    invited_by: string | null;
    accepted_at: string | null;
    expires_at: string;
    created_at: string;
  }[];

  try {
    invitations = await fetchAllRows((from, to) =>
      supabase
        .from("staff_invitations")
        .select(
          "id, clinic_id, email, full_name, role, invited_by, accepted_at, expires_at, created_at"
        )
        .in("clinic_id", branchIds)
        .order("created_at", { ascending: false })
        .range(from, to)
    );
  } catch (error) {
    logError(
      "[organizations] getOrganizationInvitations failed to load invitations:",
      error
    );

    throw error;
  }

  const inviterIds = Array.from(
    new Set(
      (invitations ?? [])
        .map((row) => row.invited_by as string | null)
        .filter((id): id is string => Boolean(id))
    )
  );

  let inviterNameById = new Map<string, string>();

  if (inviterIds.length > 0) {
    const { data: inviters, error: invitersError } = await supabase
      .from("clinic_users")
      .select("id, full_name")
      .in("id", inviterIds);

    if (invitersError) {
      logError(
        "[organizations] getOrganizationInvitations failed to load inviters:",
        invitersError
      );

      throw toError(invitersError);
    }

    inviterNameById = new Map(
      (inviters ?? []).map((row) => [
        row.id as string,
        row.full_name as string,
      ])
    );
  }

  return (invitations ?? []).map((row) => ({
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    clinic_name: branchNameById.get(row.clinic_id as string) ?? "Unknown branch",
    email: row.email as string,
    full_name: row.full_name as string,
    role: row.role as InvitableRole,
    invited_by_name: row.invited_by
      ? inviterNameById.get(row.invited_by as string) ?? null
      : null,
    accepted_at: row.accepted_at as string | null,
    expires_at: row.expires_at as string,
    created_at: row.created_at as string,
  }));
}

/* -------------------------------------- */
/* Active branch switching                */
/* -------------------------------------- */

/**
 * A pure UX convenience, never a security boundary - RLS on every
 * clinic-scoped table is what actually gates access. The RPC itself
 * requires the caller to already hold a real clinic_users row for
 * clinicId, so this can never be used to "select into" a branch the
 * caller doesn't already have legitimate access to.
 */
export async function switchActiveBranch(clinicId: string): Promise<void> {
  const { error } = await supabase.rpc("switch_active_branch", {
    p_clinic_id: clinicId,
  });

  if (error) {
    logError("[organizations] switchActiveBranch failed:", error);

    throw toError(error);
  }
}
