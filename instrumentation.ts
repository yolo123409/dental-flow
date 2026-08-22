import * as Sentry from "@sentry/nextjs";

/**
 * Production Readiness 2.0, Section 6. No monitoring provider was wired
 * up before this - app/error.tsx, app/global-error.tsx, and
 * app/admin/error.tsx already catch and log render errors, but nothing
 * outside a local devtools console ever saw them. Sentry's free tier
 * (5k errors/month, no cost) via its native Next.js instrumentation
 * hooks - no other app code changes required beyond this file,
 * instrumentation-client.ts, and one call added inside lib/logError.ts.
 *
 * Entirely inert with NEXT_PUBLIC_SENTRY_DSN unset - Sentry.init() is
 * simply never called, and every Sentry.* call elsewhere in the app is a
 * documented no-op without an active client. No DSN is fabricated here;
 * see the deployment docs for the exact env var to set.
 */
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Pure error capture, not full APM - no performance/session-replay
      // data is collected, matching "minimal service" over a heavier
      // monitoring platform.
      tracesSampleRate: 0,
      // Never send IP address, cookies, or request headers by default -
      // this app's errors already carry no PII (see lib/logError.ts /
      // getSafeErrorMessage), and this keeps it that way at the
      // transport layer too, defense in depth.
      sendDefaultPii: false,
      // Every SDK's default console-capturing integration turns each
      // console.error() call into a breadcrumb attached to the next
      // captured event. lib/logError.ts deliberately logs the FULL
      // unsanitized error (including Postgrest `details`, which can
      // embed a literal row value like a patient's email) to the local
      // console for real debugging value, immediately before reporting a
      // scrubbed, message+code-only version to Sentry - without this
      // filter, that richer local-only log rides along as a breadcrumb
      // on the very event it precedes, undermining the scrubbing in
      // lib/logError.ts#reportToMonitoring entirely. Confirmed end-to-end
      // against a real Sentry event before adding this line. Filtering
      // by breadcrumb category (not integration name) so this holds
      // identically across the Node/Edge/Browser runtimes this same
      // config effectively runs in (see instrumentation-client.ts).
      beforeBreadcrumb: (breadcrumb) =>
        breadcrumb.category === "console" ? null : breadcrumb,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
