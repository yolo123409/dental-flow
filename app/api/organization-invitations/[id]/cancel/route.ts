import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { authenticateRequest, createCallerClient } from "@/lib/supabase-request";

/**
 * cancel_organization_invitation hard-deletes the organization_invitations
 * row (unchanged behavior since migration 0016). For a brand-new invitee,
 * that row is also the only thing that made their pre-created auth
 * account's temporary credentials meaningful - once it's gone, that
 * account is a dormant, never-activated account whose user_metadata still
 * points at the now-deleted row. Left alone, anyone who later signs into
 * it (a confused re-test, or the invitee using credentials that were
 * shared before the cancel) hits "Invitation not found" - reproduced live
 * against this project. Deleting the dormant account here, via the admin
 * API, is what actually closes that off - the RPC itself has no way to
 * touch auth.users.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(req);

    if (!auth) {
      return NextResponse.json(
        { message: "Not authenticated." },
        { status: 401 }
      );
    }

    const { id: invitationId } = await params;

    const { data: existingInvitation } = await supabaseAdmin
      .from("organization_invitations")
      .select("provisioned_auth_user_id")
      .eq("id", invitationId)
      .maybeSingle();

    const provisionedUserId = existingInvitation?.provisioned_auth_user_id ?? null;

    const callerClient = createCallerClient(auth.token);

    // The actual authorization boundary (is_organization_ceo) and audit
    // log write live here, unchanged.
    const { error: cancelError } = await callerClient.rpc(
      "cancel_organization_invitation",
      { p_invitation_id: invitationId }
    );

    if (cancelError) {
      return NextResponse.json(
        {
          message: cancelError.message,
          code: cancelError.code,
          details: cancelError.details,
          hint: cancelError.hint,
        },
        { status: 400 }
      );
    }

    if (provisionedUserId) {
      const { data: provisionedUser } = await supabaseAdmin.auth.admin.getUserById(
        provisionedUserId
      );

      // Only ever delete an account that never completed its first login -
      // an already-activated member's account must never be touched by
      // cancelling an (unrelated, already-consumed) invitation row.
      if (provisionedUser?.user?.app_metadata?.must_change_password === true) {
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(
          provisionedUserId
        );

        if (deleteError) {
          // Non-fatal to the CEO's flow - the invitation is already
          // cancelled. A dormant, credential-holding account surviving is
          // worth logging loudly even though it isn't blocking.
          console.error(
            "[organization-invitations/cancel] Failed to delete dormant provisioned account:",
            deleteError
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[organization-invitations/cancel] Unexpected error:", error);

    return NextResponse.json(
      { message: "Unable to cancel invitation." },
      { status: 500 }
    );
  }
}
