import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logError";
import { getResendClient, getInvitationFromAddress } from "@/lib/email/resend";
import {
  buildBranchInvitationEmail,
  buildIndependentInvitationEmail,
} from "@/lib/email/invitationEmail";

export const dynamic = "force-dynamic";

/**
 * Server-only. Deliberately takes only the invitation `token` (plus an
 * optional, purely cosmetic `inviterName`) rather than trusting
 * client-submitted email/role/clinic-name content directly - this route
 * independently re-fetches the real invitation record via the same
 * public-by-token RPCs the /invite/[token] page itself uses
 * (get_organization_invitation_details, falling back to
 * get_invitation_details - both already granted to `anon`, migrations
 * 0008/0055). That means the email this route can ever send is entirely
 * derived from a real, already-created invitation row - it cannot be
 * used to relay arbitrary attacker-chosen email content to arbitrary
 * addresses, since a token that doesn't correspond to a real pending
 * invitation simply finds nothing and sends nothing.
 *
 * Invitation creation and email delivery are deliberately separate
 * concerns (per the calling services): the invitation row already exists
 * in the database by the time this route is ever called, and this route
 * failing/being unreachable never rolls that back - it only ever affects
 * whether an email additionally went out.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; inviterName?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { emailSent: false, reason: "Invalid request body" },
      { status: 400 }
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  const inviterName =
    typeof body.inviterName === "string" && body.inviterName.trim()
      ? body.inviterName.trim()
      : null;

  if (!token) {
    return NextResponse.json(
      { emailSent: false, reason: "Missing invitation token" },
      { status: 400 }
    );
  }

  const resend = getResendClient();
  const fromAddress = getInvitationFromAddress();

  if (!resend || !fromAddress) {
    // Not a failure of the request itself - email just isn't configured
    // in this environment yet. Callers treat this exactly like any other
    // emailSent:false outcome (invitation stays valid, link stays
    // copyable).
    return NextResponse.json({
      emailSent: false,
      reason: "Email delivery is not configured",
    });
  }

  try {
    const { data: branchData, error: branchError } = await supabase.rpc(
      "get_organization_invitation_details",
      { p_token: token }
    );

    if (branchError) throw branchError;

    const branchInvitation = branchData?.[0] as
      | {
          email: string;
          role: string;
          full_name: string;
          clinic_name: string;
          organization_name: string;
          expires_at: string;
          accepted_at: string | null;
        }
      | undefined;

    let toEmail: string;
    let role: string;
    let clinicName: string;
    let organizationName: string | null;
    let expiresAt: string;
    let acceptedAt: string | null;
    let isBranchInvitation: boolean;

    if (branchInvitation) {
      toEmail = branchInvitation.email;
      role = branchInvitation.role;
      clinicName = branchInvitation.clinic_name;
      organizationName = branchInvitation.organization_name;
      expiresAt = branchInvitation.expires_at;
      acceptedAt = branchInvitation.accepted_at;
      isBranchInvitation = true;
    } else {
      const { data: independentData, error: independentError } =
        await supabase.rpc("get_invitation_details", { p_token: token });

      if (independentError) throw independentError;

      const independentInvitation = independentData?.[0] as
        | {
            email: string;
            role: string;
            full_name: string;
            clinic_name: string;
            expires_at: string;
            accepted_at: string | null;
          }
        | undefined;

      if (!independentInvitation) {
        return NextResponse.json({
          emailSent: false,
          reason: "Invitation not found",
        });
      }

      toEmail = independentInvitation.email;
      role = independentInvitation.role;
      clinicName = independentInvitation.clinic_name;
      organizationName = null;
      expiresAt = independentInvitation.expires_at;
      acceptedAt = independentInvitation.accepted_at;
      isBranchInvitation = false;
    }

    if (acceptedAt) {
      return NextResponse.json({
        emailSent: false,
        reason: "Invitation has already been accepted",
      });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const link = `${appUrl}/invite/${token}`;

    const emailInput = {
      toEmail,
      role,
      clinicName,
      organizationName,
      inviterName,
      expiresAt,
      link,
    };

    const { subject, text, html } = isBranchInvitation
      ? buildBranchInvitationEmail(emailInput)
      : buildIndependentInvitationEmail(emailInput);

    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });

    if (sendError) {
      logError("[api/invitations/send-email] Resend send failed:", sendError);

      return NextResponse.json({
        emailSent: false,
        reason: "Email delivery failed",
      });
    }

    return NextResponse.json({ emailSent: true });
  } catch (error) {
    logError("[api/invitations/send-email] Unexpected failure:", error);

    return NextResponse.json({
      emailSent: false,
      reason: "Email delivery failed",
    });
  }
}
