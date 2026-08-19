import { Resend } from "resend";

/**
 * Server-only. RESEND_API_KEY has no NEXT_PUBLIC_ prefix, so Next.js
 * never inlines it into a client bundle - this module must only ever be
 * imported from a Route Handler (app/api/**\/route.ts) or other
 * server-only code, never from a "use client" component or a
 * services/*.ts file that client components call directly.
 *
 * Lazily constructed (not a module-level `new Resend(...)`) so importing
 * this file never throws before the key is actually needed - lets the
 * route handler return a clean "email not configured" result instead of
 * a crash when RESEND_API_KEY hasn't been filled in yet.
 */
let client: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!client) {
    client = new Resend(apiKey);
  }

  return client;
}

export function getInvitationFromAddress(): string | null {
  return process.env.INVITATION_FROM_EMAIL || null;
}
