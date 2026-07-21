import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

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

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    logError(
      "[clinicUsers] Failed to load the current clinic_users row:",
      error
    );

    throw toError(error);
  }

  return data;
}
