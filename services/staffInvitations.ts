import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { generateToken } from "@/lib/generateToken";

import { getCurrentClinicId } from "./clinic";
import { notifyStaffAdded } from "./notifications";
import { getOrganizationInvitationDetails } from "./organizations";

import {
  CreateInvitationInput,
  CreatedInvitation,
  InvitationDetails,
  StaffInvitation,
} from "@/types/staffInvitation";

/* -------------------------------------- */
/* Get pending invitations (Staff page)   */
/* -------------------------------------- */

export async function getPendingInvitations(): Promise<
  StaffInvitation[]
> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("staff_invitations")
    .select(
      "id, clinic_id, email, full_name, role, invited_by, accepted_at, expires_at, created_at"
    )
    .eq("clinic_id", clinicId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logError(
      "[staffInvitations] getPendingInvitations failed:",
      error
    );

    throw toError(error);
  }

  return (data ?? []) as StaffInvitation[];
}

/* -------------------------------------- */
/* Create invitation                      */
/* -------------------------------------- */

function buildInviteLink(token: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  return `${origin}/invite/${token}`;
}

export async function createInvitation(
  input: CreateInvitationInput
): Promise<{ invitation: CreatedInvitation; link: string }> {
  const { data, error } = await supabase.rpc(
    "create_staff_invitation",
    {
      p_email: input.email.trim(),
      p_full_name: input.full_name.trim(),
      p_role: input.role,
      p_token: generateToken(),
    }
  );

  if (error) {
    logError("[staffInvitations] createInvitation failed:", error);

    throw toError(error);
  }

  const invitation = data[0] as CreatedInvitation;

  return {
    invitation,
    link: buildInviteLink(invitation.token),
  };
}

/* -------------------------------------- */
/* Resend invitation                      */
/* -------------------------------------- */

export async function resendInvitation(
  invitationId: string
): Promise<{ link: string }> {
  const { data, error } = await supabase.rpc(
    "resend_staff_invitation",
    {
      p_invitation_id: invitationId,
      p_token: generateToken(),
    }
  );

  if (error) {
    logError("[staffInvitations] resendInvitation failed:", error);

    throw toError(error);
  }

  const result = data[0] as {
    token: string;
    expires_at: string;
  };

  return { link: buildInviteLink(result.token) };
}

/* -------------------------------------- */
/* Cancel invitation                      */
/* -------------------------------------- */

export async function cancelInvitation(
  invitationId: string
): Promise<void> {
  const { error } = await supabase
    .from("staff_invitations")
    .delete()
    .eq("id", invitationId);

  if (error) {
    logError("[staffInvitations] cancelInvitation failed:", error);

    throw toError(error);
  }
}

/* -------------------------------------- */
/* Public: look up an invitation by token */
/* (no clinic session required)           */
/* -------------------------------------- */

export async function getInvitationDetails(
  token: string
): Promise<InvitationDetails | null> {
  const { data, error } = await supabase.rpc(
    "get_invitation_details",
    { p_token: token }
  );

  if (error) {
    logError(
      "[staffInvitations] getInvitationDetails failed:",
      error
    );

    throw toError(error);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0] as InvitationDetails;
}

/* -------------------------------------- */
/* Accept invitation (post sign-up)       */
/* -------------------------------------- */

export interface AcceptedInvitation {
  clinic_id: string;
  clinic_user_id: string;
  role: string;
  full_name: string;
}

/**
 * Tries the SEPARATE get_organization_invitation_details lookup first
 * (a cheap, read-only, side-effect-free RPC that returns a row ONLY for
 * a branch invitation - see migration 0055) purely to decide which
 * acceptance RPC applies. A branch invitation must go through
 * accept_branch_invitation, which allows an existing organization member
 * to accept a second/third branch; every other invitation (that lookup
 * finding nothing) goes through the original, completely untouched
 * accept_staff_invitation/get_invitation_details pair from migration
 * 0008. Both callers of this function (the invite page, and
 * AuthContext's deferred acceptPendingInvitationIfNeeded) stay
 * completely unaware of the distinction - centralizing it here is what
 * keeps the independent-clinic acceptance path provably unaffected by
 * branch invitations existing.
 */
export async function acceptInvitation(
  token: string
): Promise<AcceptedInvitation> {
  const organizationDetails = await getOrganizationInvitationDetails(token);

  const rpcName = organizationDetails
    ? "accept_branch_invitation"
    : "accept_staff_invitation";

  const { data, error } = await supabase.rpc(rpcName, { p_token: token });

  if (error) {
    logError(`[staffInvitations] acceptInvitation (${rpcName}) failed:`, error);

    throw toError(error);
  }

  const accepted = data[0] as AcceptedInvitation;

  await notifyStaffAdded({
    id: accepted.clinic_user_id,
    full_name: accepted.full_name,
    role: accepted.role,
  });

  return accepted;
}
