import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { authenticateRequest, createCallerClient } from "@/lib/supabase-request";
import { generatePassword } from "@/lib/generatePassword";
import { sendEmail } from "@/lib/email/resend";
import {
  buildExistingAccountInvitationEmail,
  buildNewAccountInvitationEmail,
} from "@/lib/email/organizationInvitationEmails";

interface CreatedInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
  invited_by_name: string | null;
}

function isAlreadyRegisteredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { code?: string; message?: string; status?: number };

  if (err.code === "email_exists") return true;

  const message = (err.message ?? "").toLowerCase();

  return (
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);

    if (!auth) {
      return NextResponse.json(
        { message: "Not authenticated." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const {
      email: rawEmail,
      role,
      branchAccess,
      branchIds,
      token,
      fullName,
      message,
      organizationName,
      branchNames,
    } = body as {
      email: string;
      role: string;
      branchAccess: string;
      branchIds: string[] | null;
      token: string;
      fullName: string;
      message?: string | null;
      organizationName: string;
      branchNames: string[];
    };

    // Normalized the same way create_organization_invitation stores it
    // (lower(trim(p_email))) - keeps the auth account's email byte-identical
    // to what's on the invitation row, no case-mismatch risk between them.
    const email = rawEmail.trim().toLowerCase();

    const callerClient = createCallerClient(auth.token);

    // All existing validation (role/branch validity, duplicate invite/
    // member checks, audit logging) lives in this unchanged RPC - the
    // caller-scoped client makes auth.uid() resolve exactly as it does when
    // called directly from the browser, so is_organization_ceo() etc. keep
    // working with zero SQL changes.
    const { data: invitationRows, error: invitationError } =
      await callerClient.rpc("create_organization_invitation", {
        p_email: email,
        p_role: role,
        p_branch_access: branchAccess,
        p_branch_ids: branchAccess === "selected" ? branchIds ?? [] : null,
        p_token: token,
        p_full_name: fullName,
        p_message: message ?? null,
      });

    if (invitationError) {
      return NextResponse.json(
        {
          message: invitationError.message,
          code: invitationError.code,
          details: invitationError.details,
          hint: invitationError.hint,
        },
        { status: 400 }
      );
    }

    const invitation = (invitationRows as CreatedInvitation[])[0];
    const origin = new URL(req.url).origin;

    async function persistEmailStatus(result: {
      success: boolean;
      error?: string;
    }) {
      const status = result.success ? "sent" : "failed";

      const { error } = await callerClient.rpc(
        "set_organization_invitation_email_status",
        {
          p_invitation_id: invitation.invitation_id,
          p_status: status,
          p_error: result.error ?? null,
        }
      );

      if (error) {
        console.error(
          "[organization-invitations] Failed to persist email status:",
          error
        );
      }

      return status;
    }

    // Attempt to pre-create the invitee's account with a generated
    // temporary password. If the email already has an account, this fails
    // with an "already registered" style error - that's the signal to fall
    // back to the existing sign-in-and-join flow untouched (no password
    // generated, none of their existing credentials touched).
    const temporaryPassword = generatePassword();

    const { data: createdUser, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          pending_organization_invitation_token: token,
          pending_full_name: fullName,
        },
        app_metadata: {
          must_change_password: true,
        },
      });

    if (createUserError) {
      if (isAlreadyRegisteredError(createUserError)) {
        const emailContent = buildExistingAccountInvitationEmail({
          organizationName,
          role,
          branchNames,
          invitedByName: invitation.invited_by_name,
          acceptUrl: `${origin}/org-invite/${token}`,
        });

        const sendResult = await sendEmail({
          to: email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });

        const emailStatus = await persistEmailStatus(sendResult);

        return NextResponse.json({
          mode: "existing_account",
          invitation,
          emailStatus,
          emailError: sendResult.error,
        });
      }

      // The invitation row from above is now orphaned - no account exists
      // for it to ever be accepted with, and nothing was sent to anyone.
      // Roll it back rather than leaving a dangling Pending invitation and
      // reporting success.
      await callerClient.rpc("cancel_organization_invitation", {
        p_invitation_id: invitation.invitation_id,
      });

      return NextResponse.json(
        {
          message:
            "Invitation could not be completed - no account was created and nothing was sent.",
          details: createUserError.message,
        },
        { status: 502 }
      );
    }

    const { error: linkError } = await callerClient.rpc(
      "link_organization_invitation_provisioned_user",
      {
        p_invitation_id: invitation.invitation_id,
        p_auth_user_id: createdUser.user.id,
      }
    );

    if (linkError) {
      // Non-fatal to the CEO's flow (the account and invitation both exist
      // and work) - only resend's credential-rotation lookup degrades.
      console.error(
        "[organization-invitations] Failed to link provisioned user:",
        linkError
      );
    }

    const emailContent = buildNewAccountInvitationEmail({
      organizationName,
      role,
      branchNames,
      email,
      temporaryPassword,
      loginUrl: `${origin}/auth/login`,
    });

    const sendResult = await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const emailStatus = await persistEmailStatus(sendResult);

    return NextResponse.json({
      mode: "new_account",
      invitation,
      credentials: {
        email,
        temporaryPassword,
      },
      emailStatus,
      emailError: sendResult.error,
    });
  } catch (error) {
    console.error("[organization-invitations] Unexpected error:", error);

    return NextResponse.json(
      { message: "Unable to create invitation." },
      { status: 500 }
    );
  }
}
