import { logError } from "@/lib/logError";

/**
 * Client-side trigger for the server-only /api/invitations/send-email
 * route (app/api/invitations/send-email/route.ts) - this is the only
 * place RESEND_API_KEY is ever used, and it never reaches the browser.
 * This function only ever returns a boolean; it deliberately never
 * throws, since a failed email send must never be treated as a failed
 * invitation - the invitation row this is called after already exists
 * in the database by the time this runs, and stays valid either way.
 *
 * Shared by both services/staffInvitations.ts#createInvitation
 * (independent-clinic path) and services/organizations.ts#createBranchInvitation
 * (branch path) - kept in its own module (rather than living in either
 * of those files) so neither has to import the other just for this,
 * avoiding a circular import between them.
 */
export async function sendInvitationEmail(
  token: string,
  inviterName: string | null
): Promise<boolean> {
  try {
    const response = await fetch("/api/invitations/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, inviterName }),
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as { emailSent?: boolean };

    return result.emailSent === true;
  } catch (error) {
    logError("[invitationEmail] sendInvitationEmail failed:", error);

    return false;
  }
}
