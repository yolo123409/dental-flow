import { supabase } from "@/lib/supabase";
import { ClinicUser } from "@/types/clinicUser";

import { getCurrentClinicId } from "./clinic";
import { notifyStaffRoleChanged } from "./notifications";


export async function getUsers(): Promise<ClinicUser[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as ClinicUser[];
}

export async function getUser(
  id: string
): Promise<ClinicUser> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) throw error;

  return data as ClinicUser;
}

export async function updateUser(
  id: string,
  updates: Partial<ClinicUser>
): Promise<ClinicUser> {
  const clinicId = await getCurrentClinicId();

  const { data: existing } = await supabase
    .from("clinic_users")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("clinic_users")
    .update(updates)
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  if (
    updates.role !== undefined &&
    existing &&
    updates.role !== existing.role
  ) {
    await notifyStaffRoleChanged(data as ClinicUser);
  }

  return data as ClinicUser;
}

export async function suspendUser(id: string) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Suspended",
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) throw error;
}

export async function activateUser(id: string) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Active",
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteUser(id: string) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) throw error;
}

