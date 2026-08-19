/**
 * Deduplicates concurrent calls to the same not-safely-repeatable
 * operation within this browser tab. Onboarding provisioning (clinic,
 * organization, invitation acceptance) can legitimately be triggered
 * twice at once - once by the form/page that just signed the user in,
 * and once by AuthContext's own auth-state-change handler reacting to
 * the same sign-in - and the underlying RPCs only guard against a
 * *second, later* attempt (an existing row), not two attempts racing
 * concurrently. Keying a shared in-flight promise by an operation id
 * means the second caller just awaits the first caller's outcome
 * instead of independently re-running the check-then-create logic.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function runExclusive<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);

  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);

  return promise;
}
