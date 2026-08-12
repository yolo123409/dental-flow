import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { generateToken } from "@/lib/generateToken";

import { getCurrentOrganizationUser } from "./organizations";

import {
  CreateOrganizationInvitationInput,
  CreateOrganizationInvitationResult,
  OrganizationInvitation,
  OrganizationInvitationDetails,
  ResendOrganizationInvitationResult,
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

  const { data, error } = await supabase.rpc(
    "get_organization_pending_invitations",
    { p_organization_id: organizationUser.organization_id }
  );

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

async function getAccessTokenOrThrow(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated.");
  }

  return session.access_token;
}

/**
 * Account creation (for brand-new invitees) needs the service-role key, so
 * this now goes through app/api/organization-invitations instead of
 * calling create_organization_invitation directly - see that route for the
 * full flow. The RPC itself, and all of its validation, is unchanged.
 */
export async function createOrganizationInvitation(
  input: CreateOrganizationInvitationInput
): Promise<CreateOrganizationInvitationResult> {
  const accessToken = await getAccessTokenOrThrow();
  const token = generateToken();

  const response = await fetch("/api/organization-invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      email: input.email.trim(),
      role: input.role,
      branchAccess: input.branchAccess,
      branchIds:
        input.branchAccess === "selected" ? input.branchIds ?? [] : null,
      token,
      fullName: input.fullName.trim(),
      message: input.message?.trim() || null,
      organizationName: input.organizationName,
      branchNames: input.branchNames,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    logError(
      "[organizationInvitations] createOrganizationInvitation failed:",
      body
    );

    throw toError(body);
  }

  const link = buildOrganizationInviteLink(token);

  if (body.mode === "new_account") {
    return {
      mode: "new_account",
      invitation: body.invitation,
      credentials: body.credentials,
      link,
      emailStatus: body.emailStatus,
      emailError: body.emailError,
    };
  }

  return {
    mode: "existing_account",
    invitation: body.invitation,
    link,
    emailStatus: body.emailStatus,
    emailError: body.emailError,
  };
}

/* -------------------------------------- */
/* Resend invitation                      */
/* -------------------------------------- */

/**
 * organizationName/role/branchNames/invitedByName come from the caller's
 * already-loaded OrganizationInvitation record (Pending Invitations table)
 * rather than a second server-side lookup - the client already has them.
 */
export async function resendOrganizationInvitation(
  invitation: Pick<
    OrganizationInvitation,
    "id" | "role" | "branch_names" | "invited_by_name"
  >,
  organizationName: string
): Promise<ResendOrganizationInvitationResult> {
  const accessToken = await getAccessTokenOrThrow();
  const token = generateToken();

  const response = await fetch(
    `/api/organization-invitations/${invitation.id}/resend`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        organizationName,
        role: invitation.role,
        branchNames: invitation.branch_names,
        invitedByName: invitation.invited_by_name,
      }),
    }
  );

  const body = await response.json();

  if (!response.ok) {
    logError(
      "[organizationInvitations] resendOrganizationInvitation failed:",
      body
    );

    throw toError(body);
  }

  const link = buildOrganizationInviteLink(token);

  if (body.mode === "new_account") {
    return {
      mode: "new_account",
      credentials: body.credentials,
      link,
      emailStatus: body.emailStatus,
      emailError: body.emailError,
    };
  }

  return {
    mode: "link_only",
    link,
    emailStatus: body.emailStatus,
    emailError: body.emailError,
  };
}

/* -------------------------------------- */
/* Cancel invitation                      */
/* -------------------------------------- */

/**
 * Goes through app/api/organization-invitations/[id]/cancel rather than
 * calling the RPC directly - a brand-new invitee's dormant pre-created
 * account (never activated) needs deleting via the admin API alongside the
 * invitation row, or its stale credentials become a permanent "Invitation
 * not found" trap for anyone who later signs into it.
 */
export async function cancelOrganizationInvitation(
  invitationId: string
): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();

  const response = await fetch(
    `/api/organization-invitations/${invitationId}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));

    logError(
      "[organizationInvitations] cancelOrganizationInvitation failed:",
      body
    );

    throw toError(body);
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

/* -------------------------------------- */
/* Existing-account detection             */
/* -------------------------------------- */

/**
 * Whether the invited email already has a DentalFlow auth account. Derives
 * the email from the invitation's own token server-side - never accepts a
 * client-supplied email - so this can't be used to enumerate arbitrary
 * accounts. Used by the accept-invitation flow to decide whether to show a
 * sign-up form or a sign-in form.
 */
export async function checkInvitationEmailHasAccount(
  token: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "check_invitation_email_has_account",
    { p_token: token }
  );

  if (error) {
    logError(
      "[organizationInvitations] checkInvitationEmailHasAccount failed:",
      error
    );

    throw toError(error);
  }

  return Boolean(data);
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
