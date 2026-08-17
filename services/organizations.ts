import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import {
  OrganizationUser,
  OrganizationBranch,
  OrganizationInvitationDetails,
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
