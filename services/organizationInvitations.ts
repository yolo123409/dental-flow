import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { generateToken } from "@/lib/generateToken";

import { getCurrentOrganizationUser } from "./organizations";

import {
  CreateOrganizationInvitationInput,
  CreatedOrganizationInvitation,
  OrganizationInvitation,
  OrganizationInvitationDetails,
} from "@/types/organizationInvitation";

/* -------------------------------------- */
/* Get pending invitations (Team & Access) */
/* -------------------------------------- */

export async function getPendingOrganizationInvitations(): Promise<
  OrganizationInvitation[]
> {
  const organizationUser = await getCurrentOrganizationUser();

  if (!organizationUser) {
    return [];
  }

  const { data, error } = await supabase
    .from("organization_invitations")
    .select(
      "id, organization_id, email, role, branch_access, invited_by, accepted_at, expires_at, created_at"
    )
    .eq("organization_id", organizationUser.organization_id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logError(
      "[organizationInvitations] getPendingOrganizationInvitations failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as OrganizationInvitation[];
}

/* -------------------------------------- */
/* Create invitation                      */
/* -------------------------------------- */

function buildOrganizationInviteLink(token: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  return `${origin}/org-invite/${token}`;
}

export async function createOrganizationInvitation(
  input: CreateOrganizationInvitationInput
): Promise<{ invitation: CreatedOrganizationInvitation; link: string }> {
  const { data, error } = await supabase.rpc(
    "create_organization_invitation",
    {
      p_email: input.email.trim(),
      p_role: input.role,
      p_branch_access: input.branchAccess,
      p_branch_ids:
        input.branchAccess === "selected" ? input.branchIds ?? [] : null,
      p_token: generateToken(),
    }
  );

  if (error) {
    logError(
      "[organizationInvitations] createOrganizationInvitation failed:",
      error
    );

    throw toError(error);
  }

  const invitation = data[0] as CreatedOrganizationInvitation;

  return {
    invitation,
    link: buildOrganizationInviteLink(invitation.token),
  };
}

/* -------------------------------------- */
/* Resend invitation                      */
/* -------------------------------------- */

export async function resendOrganizationInvitation(
  invitationId: string
): Promise<{ link: string }> {
  const { data, error } = await supabase.rpc(
    "resend_organization_invitation",
    {
      p_invitation_id: invitationId,
      p_token: generateToken(),
    }
  );

  if (error) {
    logError(
      "[organizationInvitations] resendOrganizationInvitation failed:",
      error
    );

    throw toError(error);
  }

  const result = data[0] as {
    token: string;
    expires_at: string;
  };

  return { link: buildOrganizationInviteLink(result.token) };
}

/* -------------------------------------- */
/* Cancel invitation                      */
/* -------------------------------------- */

export async function cancelOrganizationInvitation(
  invitationId: string
): Promise<void> {
  const { error } = await supabase
    .from("organization_invitations")
    .delete()
    .eq("id", invitationId);

  if (error) {
    logError(
      "[organizationInvitations] cancelOrganizationInvitation failed:",
      error
    );

    throw toError(error);
  }
}

/* -------------------------------------- */
/* Public: look up an invitation by token */
/* (no session required)                  */
/* -------------------------------------- */

export async function getOrganizationInvitationDetails(
  token: string
): Promise<OrganizationInvitationDetails | null> {
  const { data, error } = await supabase.rpc(
    "get_organization_invitation_details",
    { p_token: token }
  );

  if (error) {
    logError(
      "[organizationInvitations] getOrganizationInvitationDetails failed:",
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
/* Accept invitation (post sign-up)       */
/* -------------------------------------- */

export interface AcceptedOrganizationInvitation {
  organization_id: string;
  organization_user_id: string;
  role: string;
  full_name: string;
}

export async function acceptOrganizationInvitation(
  token: string,
  fullName: string
): Promise<AcceptedOrganizationInvitation> {
  const { data, error } = await supabase.rpc(
    "accept_organization_invitation",
    { p_token: token, p_full_name: fullName }
  );

  if (error) {
    logError(
      "[organizationInvitations] acceptOrganizationInvitation failed:",
      error
    );

    throw toError(error);
  }

  return data[0] as AcceptedOrganizationInvitation;
}

/**
 * Mirrors provisionPendingClinicIfNeeded/provisionPendingOrganizationIfNeeded
 * (services/clinic.ts, services/organizations.ts) for the case where email
 * confirmation is required between accepting an org invitation and the
 * session actually becoming available - called from AuthContext.loadProfile
 * once a session appears, so it must be safe to call more than once.
 */
export async function provisionPendingOrganizationInvitationIfNeeded() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const pendingToken = user.user_metadata
    ?.pending_organization_invitation_token as string | undefined;

  const pendingFullName = user.user_metadata
    ?.pending_full_name as string | undefined;

  if (!pendingToken || !pendingFullName) {
    return false;
  }

  const existing = await getCurrentOrganizationUser();

  if (existing) {
    return false;
  }

  try {
    await acceptOrganizationInvitation(pendingToken, pendingFullName);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    // A concurrent call (immediate-session branch racing with
    // AuthContext's own check) may have already accepted it.
    if (message.includes("already linked")) {
      return false;
    }

    throw error;
  }

  return true;
}
