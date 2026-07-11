import { supabase } from "@/lib/supabase";
import { ClinicUser } from "@/types/clinicUser";


export async function getUsers(): Promise<ClinicUser[]> {
  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as ClinicUser[];
}

export async function getUser(
  id: string
): Promise<ClinicUser> {
  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data as ClinicUser;
}

export async function createUser(
  user: Partial<ClinicUser>
): Promise<ClinicUser> {
  const { data, error } = await supabase
    .from("clinic_users")
    .insert({
      ...user,
      status: "Active",
    })
    .select()
    .single();

  if (error) throw error;

  return data as ClinicUser;
}

export async function updateUser(
  id: string,
  updates: Partial<ClinicUser>
): Promise<ClinicUser> {
  const { data, error } = await supabase
    .from("clinic_users")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data as ClinicUser;
}

export async function suspendUser(id: string) {
  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Suspended",
    })
    .eq("id", id);

  if (error) throw error;
}

export async function activateUser(id: string) {
  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Active",
    })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteUser(id: string) {
  const { error } = await supabase
    .from("clinic_users")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

