interface NormalizedError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
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
    };
  }

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;

    return {
      message:
        typeof e.message === "string"
          ? e.message
          : JSON.stringify(error),
      code: typeof e.code === "string" ? e.code : undefined,
      details:
        typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
    };
  }

  return { message: String(error) };
}

/**
 * Logs message/code/details/hint/stack instead of a bare error object, so
 * a Postgrest error (a plain object, not an Error instance - message/code/
 * details/hint but no .toString() override) never prints as a useless
 * "[object Object]" in the console.
 */
export function logError(
  context: string,
  error: unknown
): NormalizedError {
  const normalized = normalize(error);

  console.error(context, normalized);

  return normalized;
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
