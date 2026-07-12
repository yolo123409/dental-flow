import { supabase } from "@/lib/supabase";

export async function getCurrentClinicUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } =
    await supabase
      .from("clinic_users")
      .select("*")
      .eq("id", user.id)
      .single();

  if (error) throw error;

  return data;
}