import { supabase } from "@/lib/supabase";

import { getCurrentClinicUser } from "./clinicUsers";
import { acceptInvitation } from "./staffInvitations";

export async function getCurrentClinicId() {
  const user =
    await getCurrentClinicUser();

  if (!user) {
    throw new Error(
      "No authenticated clinic user found."
    );
  }

  if (!user.clinic_id) {
    throw new Error(
      "This user is not linked to a clinic."
    );
  }

  return user.clinic_id;
}

interface CreateClinicWithAdminInput {
  clinicName: string;
  fullName: string;
  email: string;
  phone?: string;
}

export async function createClinicWithAdmin(
  input: CreateClinicWithAdminInput
) {
  console.log(
    "[onboarding] calling supabase.rpc('create_clinic_with_admin')",
    input
  );

  const { data, error } = await supabase.rpc(
    "create_clinic_with_admin",
    {
      p_clinic_name: input.clinicName,
      p_owner_full_name: input.fullName,
      p_owner_email: input.email,
      p_owner_phone: input.phone ?? null,
    }
  );

  if (error) {
    console.error(
      "[onboarding] create_clinic_with_admin RPC returned an error:",
      error
    );

    throw error;
  }

  console.log(
    "[onboarding] create_clinic_with_admin RPC succeeded:",
    data
  );

  return data;
}

/**
 * Handles the case where a user confirmed their email (or otherwise
 * regained a session) after signup without the clinic being created yet -
 * called both right after signup (immediate-session case) and from
 * AuthContext.loadProfile (deferred/email-confirmation case), so it must be
 * safe to call more than once for the same user.
 */
export async function provisionPendingClinicIfNeeded() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.log(
      "[onboarding] provisionPendingClinicIfNeeded: no authenticated user, skipping"
    );

    return false;
  }

  const pendingClinicName = user.user_metadata
    ?.pending_clinic_name as string | undefined;

  const pendingFullName = user.user_metadata
    ?.pending_full_name as string | undefined;

  if (!pendingClinicName || !pendingFullName) {
    console.log(
      "[onboarding] provisionPendingClinicIfNeeded: no pending clinic metadata on this user, skipping"
    );

    return false;
  }

  const existing = await getCurrentClinicUser();

  if (existing) {
    console.log(
      "[onboarding] provisionPendingClinicIfNeeded: clinic_users row already exists, skipping"
    );

    return false;
  }

  console.log(
    "[onboarding] provisionPendingClinicIfNeeded: no clinic yet, creating one now:",
    pendingClinicName
  );

  try {
    await createClinicWithAdmin({
      clinicName: pendingClinicName,
      fullName: pendingFullName,
      email: user.email ?? "",
    });
  } catch (error) {
    // A concurrent call (e.g. the signup form's direct call racing with
    // AuthContext's own provisioning check) may have already created it -
    // that's a benign race, not a real failure, so don't surface it.
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("already linked")) {
      console.log(
        "[onboarding] clinic was already created by a concurrent call, continuing"
      );

      return false;
    }

    throw error;
  }

  return true;
}

/**
 * Mirrors provisionPendingClinicIfNeeded() above, but for staff who signed
 * up by accepting an invitation link. Handles the same deferred-session
 * case (email confirmation required, so the invite page's own signUp()
 * call has no immediate session to accept with) - called both right after
 * the invite page's signUp() and from AuthContext.loadProfile.
 */
export async function acceptPendingInvitationIfNeeded() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const pendingToken = user.user_metadata
    ?.pending_invitation_token as string | undefined;

  if (!pendingToken) {
    return false;
  }

  const existing = await getCurrentClinicUser();

  if (existing) {
    return false;
  }

  try {
    await acceptInvitation(pendingToken);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    // A concurrent call (immediate-session branch racing with
    // AuthContext's own check) may have already accepted it.
    if (message.includes("already linked")) {
      return false;
    }

    throw error;
  }

  return true;
}