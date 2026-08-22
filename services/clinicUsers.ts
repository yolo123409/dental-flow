import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { runExclusive } from "@/lib/inFlightGuard";

import { getCurrentOrganizationUser, switchActiveBranch } from "./organizations";

/**
 * Every independent-clinic user has exactly one clinic_users row, so this
 * always resolves via the fast, unchanged single-row path below - byte
 * for byte the same query and result as before multi-branch existed.
 * Only a multi-branch organization member (a CEO, or a Member of more
 * than one branch) can ever have more than one row, which is resolved
 * via the org-level active-branch selection (never a client-supplied
 * value - see services/organizations.ts#switchActiveBranch).
 *
 * Wrapped in runExclusive (same in-flight dedup already used for
 * onboarding provisioning): nearly every services/*.ts function calls
 * this at its top, and a single page load commonly fires several of
 * them at once (e.g. the Dashboard's parallel widget fetches) - each
 * independently re-running auth.getUser() (a real network round trip,
 * not a local session read) and the clinic_users query for the identical
 * result. Found during a production-hardening audit to be a systemic
 * request-count amplifier. This only collapses calls that are
 * genuinely concurrent (in flight at the same instant); the in-flight
 * entry is removed as soon as it resolves, so it never becomes a
 * time-based cache and can never serve stale data across a branch
 * switch or separate page load.
 */
export function getCurrentClinicUser() {
  return runExclusive("getCurrentClinicUser", getCurrentClinicUserUncached);
}

async function getCurrentClinicUserUncached() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    logError("[clinicUsers] Failed to get auth user:", authError);

    throw toError(authError);
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("auth_user_id", user.id);

  if (error) {
    logError(
      "[clinicUsers] Failed to load the current clinic_users row:",
      error
    );

    throw toError(error);
  }

  const rows = data ?? [];

  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  return resolveActiveClinicUser(rows);
}

/**
 * Multi-branch resolution, split out so the common (0 or 1 row) path
 * above never even imports/evaluates anything organization-related.
 */
async function resolveActiveClinicUser(rows: Record<string, unknown>[]) {
  const orgUser = await getCurrentOrganizationUser();

  const active = rows.find(
    (row) => row.clinic_id === orgUser?.active_clinic_id
  );

  if (active) return active;

  // No active branch selected yet, or it no longer matches a real row
  // (e.g. revoked access) - deterministically fall back to the
  // earliest-granted branch and persist it, so this resolves the same
  // way on every subsequent load instead of picking differently each
  // time. Single-branch organization members never reach this function
  // at all (they have exactly one row, handled above), matching "no
  // unnecessary branch-selection screen".
  const fallback = [...rows].sort(
    (a, b) =>
      new Date((a.created_at as string) ?? 0).getTime() -
      new Date((b.created_at as string) ?? 0).getTime()
  )[0];

  try {
    await switchActiveBranch(fallback.clinic_id as string);
  } catch (switchError) {
    // Best-effort - the user still gets a working session even if this
    // particular write fails (e.g. a transient network blip); it'll just
    // re-resolve to the same deterministic fallback next load.
    logError(
      "[clinicUsers] Failed to persist fallback active branch:",
      switchError
    );
  }

  return fallback;
}
