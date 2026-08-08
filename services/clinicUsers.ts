import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

// Which clinic_users row getCurrentClinicUser() should resolve to, for a
// user who may now have more than one (organization members who've
// switched into several branches). sessionStorage, not localStorage: this
// is a UX convenience only, never an authorization mechanism (RLS + the
// switch_active_branch RPC are what actually gate access, regardless of
// what's stored here) - it survives page refreshes within a session but
// is empty on a fresh one, which is what makes "CEO's default login
// destination is Organization Overview, not an arbitrary branch" work
// without extra reset logic (see contexts/AuthContext.tsx).
const ACTIVE_CLINIC_STORAGE_KEY = "dentalflow_active_clinic_id";

export function getStoredActiveClinicId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    return sessionStorage.getItem(ACTIVE_CLINIC_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredActiveClinicId(clinicId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (clinicId) {
      sessionStorage.setItem(ACTIVE_CLINIC_STORAGE_KEY, clinicId);
    } else {
      sessionStorage.removeItem(ACTIVE_CLINIC_STORAGE_KEY);
    }
  } catch {
    // sessionStorage can throw in private-browsing/quota edge cases - the
    // active clinic then just falls back to "first row", never a crash.
  }
}

/**
 * A user may now have more than one clinic_users row (organization
 * members who've switched into multiple branches) - `.limit(1)` before
 * `.maybeSingle()` guarantees this never throws regardless of row count
 * (Postgrest's cardinality check only fires on what's actually returned,
 * and the limit caps that at 1), while still resolving to a specific row
 * when an active clinic is stored.
 */
export async function getCurrentClinicUser() {
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

  const activeClinicId = getStoredActiveClinicId();

  let query = supabase
    .from("clinic_users")
    .select("*")
    .eq("auth_user_id", user.id);

  if (activeClinicId) {
    query = query.eq("clinic_id", activeClinicId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logError(
      "[clinicUsers] Failed to load the current clinic_users row:",
      error
    );

    throw toError(error);
  }

  if (!data && activeClinicId) {
    // The stored active clinic no longer resolves to a row (e.g. access
    // was revoked) - clear it so future calls fall back to the user's
    // first available clinic_users row instead of staying stuck pointing
    // at a dead clinic.
    setStoredActiveClinicId(null);
  }

  return data;
}
