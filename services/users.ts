import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { ClinicUser } from "@/types/clinicUser";

import { getCurrentClinicId } from "./clinic";
import { notifyStaffRoleChanged } from "./notifications";
import { assertPermission } from "./authorization";


export async function getUsers(): Promise<ClinicUser[]> {
  await assertPermission("users");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (error) {
    logError("[users] getUsers failed:", error);

    throw toError(error);
  }

  return (data ?? []) as ClinicUser[];
}

export async function getUser(
  id: string
): Promise<ClinicUser> {
  await assertPermission("users");

  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("clinic_users")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) {
    logError("[users] getUser failed:", error);

    throw toError(error);
  }

  return data as ClinicUser;
}

export async function updateUser(
  id: string,
  updates: Partial<ClinicUser>
): Promise<ClinicUser> {
  await assertPermission("users");

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

  if (error) {
    logError("[users] updateUser failed:", error);

    throw toError(error);
  }

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
  await assertPermission("users");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Suspended",
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[users] suspendUser failed:", error);

    throw toError(error);
  }
}

export async function activateUser(id: string) {
  await assertPermission("users");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .update({
      status: "Active",
    })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[users] activateUser failed:", error);

    throw toError(error);
  }
}

export async function deleteUser(id: string) {
  await assertPermission("users");

  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("clinic_users")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError("[users] deleteUser failed:", error);

    throw toError(error);
  }
}
