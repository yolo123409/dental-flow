import { User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { setStoredActiveClinicId } from "./clinicUsers";

import {
  Organization,
  OrganizationBranchAccess,
  OrganizationUser,
} from "@/types/organization";
import { InvitableOrganizationRole } from "@/types/organizationInvitation";

export interface OrganizationBranch {
  id: string;
  name: string;
}

/**
 * Resolves the identity to use when creating a branch on an organization
 * member's behalf (create_clinic_with_admin's p_owner_full_name/
 * p_owner_email). Email always comes from the live Supabase Auth session -
 * the only truly authoritative source - never re-derived from a possibly
 * stale organization_users row. Full name prefers the organization_users
 * row (the normal case, set at CEO registration), falling back to the
 * same pending_full_name auth metadata used elsewhere
 * (provisionPendingClinicIfNeeded/provisionPendingOrganizationIfNeeded) to
 * bootstrap a name before a formal record has one. Throws rather than
 * ever returning an empty/undefined value - a caller passing undefined
 * through to the RPC gets silently dropped from the request body instead
 * of a clear error (JSON.stringify omits undefined-valued keys).
 */
export function resolveBranchOwnerIdentity(
  organizationUser: OrganizationUser,
  authUser: User | null
): { fullName: string; email: string } {
  const email = authUser?.email?.trim() || "";

  const fullName =
    organizationUser.full_name?.trim() ||
    (authUser?.user_metadata?.pending_full_name as
      | string
      | undefined
    )?.trim() ||
    "";

  if (!fullName || !email) {
    console.error(
      "[organizations] Could not resolve owner full name/email from any source:",
      {
        organizationUserFullName: organizationUser.full_name,
        organizationUserEmail: organizationUser.email,
        authUserEmail: authUser?.email,
        pendingFullNameMetadata:
          authUser?.user_metadata?.pending_full_name,
      }
    );

    throw new Error(
      "Your account is missing required profile information. Please log out and back in, then try again."
    );
  }

  return { fullName, email };
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

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("organization_users")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "Active")
    .maybeSingle();

  if (error) {
    logError(
      "[organizations] Failed to load the current organization_users row:",
      error
    );

    throw toError(error);
  }

  return data as OrganizationUser | null;
}

interface CreateOrganizationWithCeoInput {
  organizationName: string;
  fullName: string;
  email: string;
}

export async function createOrganizationWithCeo(
  input: CreateOrganizationWithCeoInput
) {
  console.log(
    "[onboarding] calling supabase.rpc('create_organization_with_ceo')",
    input
  );

  const { data, error } = await supabase.rpc(
    "create_organization_with_ceo",
    {
      p_organization_name: input.organizationName,
      p_owner_full_name: input.fullName,
      p_owner_email: input.email,
    }
  );

  if (error) {
    logError(
      "[onboarding] create_organization_with_ceo RPC returned an error:",
      error
    );

    throw toError(error);
  }

  console.log(
    "[onboarding] create_organization_with_ceo RPC succeeded:",
    data
  );

  return data;
}

/**
 * Mirrors provisionPendingClinicIfNeeded() (services/clinic.ts) for the
 * organization signup path - handles the case where a user confirmed their
 * email (or otherwise regained a session) after CEO signup without the
 * organization being created yet. Called both right after signup
 * (immediate-session case) and from AuthContext.loadProfile
 * (deferred/email-confirmation case), so it must be safe to call more than
 * once for the same user.
 */
export async function provisionPendingOrganizationIfNeeded() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.log(
      "[onboarding] provisionPendingOrganizationIfNeeded: no authenticated user, skipping"
    );

    return false;
  }

  const pendingOrganizationName = user.user_metadata
    ?.pending_organization_name as string | undefined;

  const pendingFullName = user.user_metadata
    ?.pending_full_name as string | undefined;

  if (!pendingOrganizationName || !pendingFullName) {
    console.log(
      "[onboarding] provisionPendingOrganizationIfNeeded: no pending organization metadata on this user, skipping"
    );

    return false;
  }

  const existing = await getCurrentOrganizationUser();

  if (existing) {
    console.log(
      "[onboarding] provisionPendingOrganizationIfNeeded: organization_users row already exists, skipping"
    );

    return false;
  }

  console.log(
    "[onboarding] provisionPendingOrganizationIfNeeded: no organization yet, creating one now:",
    pendingOrganizationName
  );

  try {
    await createOrganizationWithCeo({
      organizationName: pendingOrganizationName,
      fullName: pendingFullName,
      email: user.email ?? "",
    });
  } catch (error) {
    // A concurrent call (e.g. the signup form's direct call racing with
    // AuthContext's own provisioning check) may have already created it -
    // that's a benign race, not a real failure, so don't surface it.
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("already linked")) {
      console.log(
        "[onboarding] organization was already created by a concurrent call, continuing"
      );

      return false;
    }

    throw error;
  }

  return true;
}

/**
 * Active members of the caller's own organization (Team & Access page).
 * Scoped to whatever organization the caller belongs to - RLS
 * (organization_users_select_member) further guarantees this can never
 * return another organization's members even if that changed.
 */
export async function getOrganizationMembers(): Promise<OrganizationUser[]> {
  const organizationUser = await getCurrentOrganizationUser();

  if (!organizationUser) {
    return [];
  }

  const { data, error } = await supabase
    .from("organization_users")
    .select("*")
    .eq("organization_id", organizationUser.organization_id)
    .eq("status", "Active")
    .order("created_at", { ascending: true });

  if (error) {
    logError("[organizations] getOrganizationMembers failed:", error);

    throw toError(error);
  }

  return (data ?? []) as OrganizationUser[];
}

/**
 * Branches (clinics) belonging to an organization - used by the invite
 * modal's "Selected Branches" picker.
 */
export async function getOrganizationBranches(
  organizationId: string
): Promise<OrganizationBranch[]> {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    logError("[organizations] getOrganizationBranches failed:", error);

    throw toError(error);
  }

  return (data ?? []) as OrganizationBranch[];
}

/**
 * The organization row itself (name, for the branch switcher/Overview
 * header). RLS (organizations_select_member) already scopes this to
 * organizations the caller actually belongs to.
 */
export async function getMyOrganization(
  organizationId: string
): Promise<Organization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    logError("[organizations] getMyOrganization failed:", error);

    throw toError(error);
  }

  return data as Organization | null;
}

/**
 * Switches the active branch: validates + lazily provisions a real
 * clinic_users row server-side (switch_active_branch RPC - never trusts
 * the browser's claim of "I'm authorized for this branch"), then persists
 * the choice for this session. Callers are expected to force a full page
 * reload afterward (not just re-render) - every /admin/* page fetches its
 * own clinic-scoped data once on mount, so only a hard reload guarantees
 * no stale branch data lingers.
 */
export async function switchActiveBranch(clinicId: string): Promise<void> {
  const { data, error } = await supabase.rpc("switch_active_branch", {
    p_clinic_id: clinicId,
  });

  if (error) {
    logError("[organizations] switchActiveBranch failed:", error);

    throw toError(error);
  }

  const result = data[0] as { clinic_id: string };

  setStoredActiveClinicId(result.clinic_id);
}

/**
 * Soft-removes an organization member's access - sets status to
 * 'Removed' rather than deleting the row (keeps history, matches "do not
 * delete the Supabase account"). is_organization_member/is_organization_ceo
 * both filter on status = 'Active', so access is cut immediately.
 * Permitted directly by RLS (organization_users_update_ceo_only), no RPC
 * needed.
 */
export async function removeOrganizationMember(
  organizationUserId: string
): Promise<void> {
  const { error } = await supabase
    .from("organization_users")
    .update({
      status: "Removed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationUserId);

  if (error) {
    logError("[organizations] removeOrganizationMember failed:", error);

    throw toError(error);
  }
}

/**
 * Renames the organization. Permitted directly by RLS
 * (organizations_update_ceo_only), no RPC needed.
 */
export async function updateOrganization(
  organizationId: string,
  updates: { name: string }
): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({
      name: updates.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId);

  if (error) {
    logError("[organizations] updateOrganization failed:", error);

    throw toError(error);
  }
}

/**
 * The specific branches a 'selected'-access member currently has -
 * used to pre-fill the Edit Member modal. Permitted by
 * organization_user_branches_select_member, which already lets any
 * Active org member read any other member's branch rows (not just their
 * own), so this works for the CEO editing someone else's access.
 */
export async function getOrganizationUserBranches(
  organizationUserId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("organization_user_branches")
    .select("clinic_id")
    .eq("organization_user_id", organizationUserId);

  if (error) {
    logError(
      "[organizations] getOrganizationUserBranches failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []).map((row) => row.clinic_id as string);
}

/**
 * Edits an existing active member's role/branch access. Permitted
 * directly by RLS (organization_users_update_ceo_only - whose
 * "role <> 'CEO'" check, on both the pre- and post-update row, is what
 * actually prevents this from ever being used to escalate someone to
 * CEO; organization_user_branches_insert_ceo_only/_delete_ceo_only for
 * the branch rows), no RPC needed.
 *
 * Branch rows: inserts the new set before deleting the stale set (not
 * delete-then-insert) - organization_user_branches gates real
 * switch_active_branch access, so if the two calls below don't complete
 * as a unit (network drop, closed tab), this ordering leaves the member
 * with a temporary superset of their old and new branches rather than
 * zero branches. Extra access is immediately correctable by re-editing;
 * a lockout would not be self-healing.
 */
export async function updateOrganizationMember(
  organizationUserId: string,
  updates: {
    role: InvitableOrganizationRole;
    branchAccess: OrganizationBranchAccess;
    branchIds: string[];
  }
): Promise<void> {
  const { error: updateError } = await supabase
    .from("organization_users")
    .update({
      role: updates.role,
      branch_access: updates.branchAccess,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationUserId);

  if (updateError) {
    logError(
      "[organizations] updateOrganizationMember failed:",
      updateError
    );

    throw toError(updateError);
  }

  if (updates.branchAccess === "all") {
    const { error: deleteError } = await supabase
      .from("organization_user_branches")
      .delete()
      .eq("organization_user_id", organizationUserId);

    if (deleteError) {
      logError(
        "[organizations] updateOrganizationMember branch cleanup failed:",
        deleteError
      );

      throw toError(deleteError);
    }

    return;
  }

  const current = await getOrganizationUserBranches(organizationUserId);

  const toAdd = updates.branchIds.filter(
    (id) => !current.includes(id)
  );

  const toRemove = current.filter(
    (id) => !updates.branchIds.includes(id)
  );

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase
      .from("organization_user_branches")
      .insert(
        toAdd.map((clinicId) => ({
          organization_user_id: organizationUserId,
          clinic_id: clinicId,
        }))
      );

    if (insertError) {
      logError(
        "[organizations] updateOrganizationMember branch insert failed:",
        insertError
      );

      throw toError(insertError);
    }
  }

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("organization_user_branches")
      .delete()
      .eq("organization_user_id", organizationUserId)
      .in("clinic_id", toRemove);

    if (deleteError) {
      logError(
        "[organizations] updateOrganizationMember branch removal failed:",
        deleteError
      );

      throw toError(deleteError);
    }
  }
}
