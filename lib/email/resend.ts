/**
 * Minimal Resend client - a single fetch() call, no SDK dependency
 * (matches this codebase's existing preference for avoiding extra
 * packages when a plain REST call is enough). Server-only: RESEND_API_KEY
 * must never reach the browser, so this is only ever imported from
 * app/api/** route handlers.
 *
 * If RESEND_API_KEY isn't set, sendEmail fails fast with a clear,
 * non-network error instead of pretending to send - this is what produces
 * an honest "not_configured" status end-to-end rather than a false
 * "sent".
 */

const RESEND_API_URL = "https://api.resend.com/emails";

// Resend's shared sandbox sender - works with no domain verification, so
// the feature is usable the moment RESEND_API_KEY is set. Sending from a
// real organization domain requires verifying that domain in the Resend
// dashboard first and setting RESEND_FROM_EMAIL accordingly - a genuine
// setup step, not something this code can do on its own.
const DEFAULT_FROM = "DentalFlow <onboarding@resend.dev>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "Email delivery is not configured (RESEND_API_KEY is not set).",
    };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));

      return {
        success: false,
        error:
          (body as { message?: string }).message ??
          `Resend returned ${response.status}.`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown email error.",
    };
  }
}
