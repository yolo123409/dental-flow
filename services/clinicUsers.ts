import { supabase } from "@/lib/supabase";

export async function getCurrentClinicUser() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}