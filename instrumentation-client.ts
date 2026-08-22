import * as Sentry from "@sentry/nextjs";

// Mirrors instrumentation.ts's server-side init - see that file for the
// rationale. Inert with NEXT_PUBLIC_SENTRY_DSN unset.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // See instrumentation.ts - drops console-derived breadcrumbs so a
    // rich local console.error() (which can carry a raw Postgrest
    // `details` string, e.g. a literal patient email from a constraint
    // violation) never rides along as context on a Sentry event.
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.category === "console" ? null : breadcrumb,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
