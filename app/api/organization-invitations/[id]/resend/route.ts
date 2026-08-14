import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { authenticateRequest, createCallerClient } from "@/lib/supabase-request";
import { generatePassword } from "@/lib/generatePassword";
import { sendEmail } from "@/lib/email/resend";
import {
  buildExistingAccountInvitationEmail,
  buildNewAccountInvitationEmail,
} from "@/lib/email/organizationInvitationEmails";

interface ResendResult {
  token: string;
  expires_at: string;
}

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

    const {
      token,
      organizationName,
      role,
      branchNames,
      invitedByName,
    } = (await req.json()) as {
      token: string;
      organizationName: string;
      role: string;
      branchNames: string[];
      invitedByName: string | null;
    };

    const callerClient = createCallerClient(auth.token);

    // Read-only lookup via the admin client - resend_organization_invitation
    // (below) is the actual authorization boundary (it re-checks
    // is_organization_ceo() via the caller-scoped client), this is only
    // deciding whether a temporary credential needs rotating alongside it.
    const { data: existingInvitation, error: existingInvitationError } =
      await supabaseAdmin
        .from("organization_invitations")
        .select("email, provisioned_auth_user_id")
        .eq("id", invitationId)
        .maybeSingle();

    // Previously this error was discarded and a missing/failed lookup fell
    // through to `to: existingInvitation?.email ?? ""` below - silently
    // asking Resend to send to an empty address instead of failing loudly.
    // Fail here instead, before any token/credential rotation happens.
    if (existingInvitationError || !existingInvitation?.email) {
      console.error(
        "[organization-invitations/resend] Could not resolve invitation email:",
        existingInvitationError
      );

      return NextResponse.json(
        { message: "Invitation not found or its email address is missing." },
        { status: 404 }
      );
    }

    // Rotates organization_invitations.token to the new value BEFORE any
    // credential rotation below - the account's user_metadata must be
    // updated with this exact new token, not the old one, or the invitee's
    // next login reads a token that no longer matches any row
    // (accept_organization_invitation's `for update` lookup finds nothing
    // and raises "Invitation not found" - this was the actual bug: a prior
    // version of this route rotated the password without ever touching
    // user_metadata, leaving it silently stale after a resend).
    const { data: resendRows, error: resendError } = await callerClient.rpc(
      "resend_organization_invitation",
      {
        p_invitation_id: invitationId,
        p_token: token,
      }
    );

    if (resendError) {
      return NextResponse.json(
        {
          message: resendError.message,
          code: resendError.code,
          details: resendError.details,
          hint: resendError.hint,
        },
        { status: 400 }
      );
    }

    const result = (resendRows as ResendResult[])[0];
    const origin = new URL(req.url).origin;

    let rotatedCredentials: { email: string; temporaryPassword: string } | null =
      null;

    if (existingInvitation?.provisioned_auth_user_id) {
      const { data: provisionedUser } = await supabaseAdmin.auth.admin.getUserById(
        existingInvitation.provisioned_auth_user_id
      );

      // Only rotate if this account never completed its first login - once
      // must_change_password is false, the person is already an active
      // member and this invitation should behave like any other resend.
      if (provisionedUser?.user?.app_metadata?.must_change_password === true) {
        const temporaryPassword = generatePassword();

        // user_metadata is shallow-merged by the admin API (verified
        // directly against this project), so this doesn't clobber
        // pending_full_name.
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          existingInvitation.provisioned_auth_user_id,
          {
            password: temporaryPassword,
            user_metadata: { pending_organization_invitation_token: result.token },
          }
        );

        if (updateError) {
          return NextResponse.json(
            {
              message: "Unable to rotate the temporary credential.",
              details: updateError.message,
            },
            { status: 502 }
          );
        }

        rotatedCredentials = {
          email: existingInvitation.email,
          temporaryPassword,
        };
      }
    }

    const emailContent = rotatedCredentials
      ? buildNewAccountInvitationEmail({
          organizationName,
          role,
          branchNames,
          email: rotatedCredentials.email,
          temporaryPassword: rotatedCredentials.temporaryPassword,
          loginUrl: `${origin}/auth/login`,
        })
      : buildExistingAccountInvitationEmail({
          organizationName,
          role,
          branchNames,
          invitedByName,
          acceptUrl: `${origin}/org-invite/${token}`,
        });

    // Temporary diagnostic (safe: never logs the key itself) - confirms
    // what THIS route's execution actually sees at send time, since the
    // create-invitation route and this resend route are separate
    // serverless function instances. Remove once confirmed resolved.
    console.log(
      "[resend-invitation] API key present:",
      !!process.env.RESEND_API_KEY
    );
    console.log("[resend-invitation] from:", process.env.RESEND_FROM_EMAIL);

    const sendResult = await sendEmail({
      to: existingInvitation.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const emailStatus = sendResult.success ? "sent" : "failed";

    const { error: statusError } = await callerClient.rpc(
      "set_organization_invitation_email_status",
      {
        p_invitation_id: invitationId,
        p_status: emailStatus,
        p_error: sendResult.error ?? null,
      }
    );

    if (statusError) {
      console.error(
        "[organization-invitations/resend] Failed to persist email status:",
        statusError
      );
    }

    if (rotatedCredentials) {
      return NextResponse.json({
        mode: "new_account",
        result,
        credentials: rotatedCredentials,
        emailStatus,
        emailError: sendResult.error,
      });
    }

    return NextResponse.json({
      mode: "link_only",
      result,
      emailStatus,
      emailError: sendResult.error,
    });
  } catch (error) {
    console.error("[organization-invitations/resend] Unexpected error:", error);

    return NextResponse.json(
      { message: "Unable to resend invitation." },
      { status: 500 }
    );
  }
}
