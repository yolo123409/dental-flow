import { supabase } from "@/lib/supabase";
import { Dentist } from "@/types/dentist";

import { getCurrentClinicId } from "./clinic";
import { assertPermission } from "./authorization";

export async function getDentists(): Promise<Dentist[]> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to fetch dentists:", error);
    return [];
  }

  return (data as Dentist[]) ?? [];
}

export async function getDentistCount(): Promise<number> {
  const clinicId = await getCurrentClinicId();

  const { count, error } = await supabase
    .from("dentists")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId);

  if (error) {
    console.error("Failed to count dentists:", error);
    return 0;
  }

  return count ?? 0;
}

export async function getDentistOptions() {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to fetch dentist options:", error);
    return [];
  }

  return data ?? [];
}

export async function getDentistById(
  id: string
): Promise<Dentist | null> {
  const clinicId = await getCurrentClinicId();

  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to fetch dentist:", error);
    return null;
  }

  return data as Dentist;
}

export async function getDentistCompletedTreatmentCount(
  dentistId: string
): Promise<number> {
  const clinicId = await getCurrentClinicId();

  const { count, error } = await supabase
    .from("appointments")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .eq("dentist_id", dentistId)
    .eq("status", "Completed");

  if (error) {
    console.error(
      "Failed to count completed dentist treatments:",
      error
    );
    throw error;
  }

  return count ?? 0;
}

export async function createDentist(
  dentist: Omit<
    Dentist,
    | "id"
    | "created_at"
    | "appointments_today"
    | "patients_seen"
    | "revenue"
  >
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .insert({ ...dentist, clinic_id: clinicId });

  if (error) {
    throw error;
  }
}

export async function updateDentist(
  id: string,
  dentist: Partial<Dentist>
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .update(dentist)
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deleteDentist(id: string) {
  // Full-app audit fix H7: deleteDentist had no permission check at all
  // (every other write in this file was already missing one too - not
  // widening scope here, just matching the page's own existing gate,
  // app/admin/dentists/page.tsx's PermissionGuard permission="patients").
  await assertPermission("patients");

  const clinicId = await getCurrentClinicId();

  // Full-app audit fix H7: no check for existing appointments before this
  // unconditional delete - the safe, correct action for a dentist who's
  // left (or is being temporarily removed from scheduling) is
  // toggleDentistStatus(id, false), which already exists and is already
  // respected by every booking picker (getDentistOptions filters on
  // active). Blocking here, rather than letting an unknown FK behavior
  // decide the outcome, protects appointment history regardless of what
  // that FK actually does today.
  const { count: appointmentCount, error: countError } = await supabase
    .from("appointments")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("dentist_id", id);

  if (countError) {
    throw countError;
  }

  if ((appointmentCount ?? 0) > 0) {
    throw new Error(
      "This dentist has appointment history and cannot be deleted. Deactivate them instead to hide them from new bookings."
    );
  }

  const { error } = await supabase
    .from("dentists")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function toggleDentistStatus(
  id: string,
  active: boolean
) {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("dentists")
    .update({ active })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    throw error;
  }
}
