import * as Sentry from "@sentry/nextjs";

interface NormalizedError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
  raw?: string;
}

/**
 * JSON.stringify(error) on a Supabase/PostgREST error - or any object
 * whose own properties happen to be non-enumerable - silently produces
 * "{}" with no warning, which is what was showing up in the console
 * instead of the real Postgres error. Object.getOwnPropertyNames sees
 * every own property regardless of enumerability, so this is a strictly
 * more reliable fallback for logging (never used for user-facing text).
 */
function safeStringify(value: unknown): string | undefined {
  try {
    const seen = new WeakSet();

    const json = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }

        return val;
      },
      2
    );

    if (json && json !== "{}") return json;

    if (value && typeof value === "object") {
      const names = Object.getOwnPropertyNames(value);

      if (names.length > 0) {
        const fallback: Record<string, unknown> = {};

        for (const name of names) {
          fallback[name] = (value as Record<string, unknown>)[name];
        }

        return JSON.stringify(fallback, null, 2);
      }
    }

    return json;
  } catch {
    return undefined;
  }
}

function normalize(error: unknown): NormalizedError {
  if (error instanceof Error) {
    const withCode = error as Error & {
      code?: string;
      details?: string;
      hint?: string;
    };

    return {
      message: error.message,
      code: withCode.code,
      details: withCode.details,
      hint: withCode.hint,
      stack: error.stack,
      raw: safeStringify(error),
    };
  }

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;

    return {
      message:
        typeof e.message === "string"
          ? e.message
          : "Unknown error - see raw",
      code: typeof e.code === "string" ? e.code : undefined,
      details:
        typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
      raw: safeStringify(error),
    };
  }

  return { message: String(error), raw: safeStringify(error) };
}

/**
 * Logs message/code/details/hint/stack instead of a bare error object, so
 * a Postgrest error (a plain object, not an Error instance - message/code/
 * details/hint but no .toString() override) never prints as a useless
 * "[object Object]" in the console.
 *
 * The summary line is logged as a pre-formatted JSON STRING, not as a
 * second object argument - Chrome/Firefox collapse an object argument to
 * a bare "Object" in the single-line console view until you manually
 * expand it, which reads as "the logging is hiding the error" even
 * though the data is technically present. A string argument always
 * renders its full content inline, no click required.
 */
export function logError(
  context: string,
  error: unknown
): NormalizedError {
  const normalized = normalize(error);

  console.error(
    context,
    JSON.stringify(
      {
        message: normalized.message,
        code: normalized.code,
        details: normalized.details,
        hint: normalized.hint,
      },
      null,
      2
    )
  );

  // Full object (including stack/raw) still available for anyone who
  // wants to expand it in devtools, just not relied on as the primary
  // readable output.
  console.error(normalized);

  reportToMonitoring(context, normalized);

  return normalized;
}

/**
 * A Postgrest constraint-violation `details` string can embed the
 * literal conflicting row value (e.g. `Key (email)=(x@y.com) already
 * exists.`), and `raw` is the full serialized error object - both are
 * exactly the kind of thing Section 6 says must never reach the
 * monitoring provider. Only `message` (a fixed, non-parameterized string
 * for any given error type) and `code` (a short Postgres/Postgrest
 * error code, e.g. "23505") are forwarded - enough to group and triage
 * an error, never enough to carry patient/staff data. A no-op if Sentry
 * was never initialized (see instrumentation.ts).
 */
function reportToMonitoring(
  context: string,
  normalized: NormalizedError
): void {
  const scrubbed = new Error(normalized.message);
  scrubbed.name = context;

  Sentry.captureException(scrubbed, {
    tags: normalized.code ? { db_error_code: normalized.code } : undefined,
  });
}

/**
 * Supabase client/RPC calls surface failures as plain objects
 * ({message, code, details, hint}), not Error instances. Throwing that
 * object directly means: no readable .message for callers, and if it
 * ever escapes an unguarded await uncaught, React/Next's error overlay
 * renders it as "[object Object]" since it has no string conversion.
 * Wrap it in a real Error (keeping code/details/hint attached) before
 * throwing so it behaves like one everywhere up the call chain.
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const normalized = normalize(error);

  const wrapped = new Error(normalized.message);

  Object.assign(wrapped, {
    code: normalized.code,
    details: normalized.details,
    hint: normalized.hint,
    cause: error,
  });

  return wrapped;
}

/**
 * Safe alternative to `error instanceof Error ? error.message : fallback`
 * for user-facing toasts/alerts - found during a production-hardening
 * audit to be the app-wide default pattern (~100 call sites), which
 * surfaces raw Postgres/PostgREST error text (constraint names, column
 * names, RLS policy wording) to any authenticated clinic user, not just
 * Owner/Admin. Always logs the real error via logError() first, so
 * nothing is lost for debugging - only what reaches the UI changes.
 *
 * A Postgrest/DB error that went through toError() always carries a
 * `code` property (even when its value is undefined - toError's
 * Object.assign sets the key regardless), because it originated from a
 * real Postgrest error object which always has that shape. A plain,
 * hand-written `throw new Error("Please upload a PNG or PDF file.")`
 * validation error never has a `code` property at all. That's a
 * reliable, zero-configuration way to tell "safe, app-authored message"
 * apart from "raw DB error" without needing every validation throw site
 * to be rewritten to use a special error class - own-property presence,
 * not value, is what's checked, so it also still works even if a real
 * Postgrest error happens to have a null/undefined code.
 */
export function getSafeErrorMessage(
  error: unknown,
  fallback: string,
  context = "[ui]"
): string {
  logError(context, error);

  if (
    error instanceof Error &&
    !Object.prototype.hasOwnProperty.call(error, "code")
  ) {
    return error.message;
  }

  return fallback;
}
