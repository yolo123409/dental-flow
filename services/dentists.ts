import { supabase } from "@/lib/supabase";
import { Dentist } from "@/types/dentist";

export async function getDentists(): Promise<Dentist[]> {
  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to fetch dentists:", error);
    return [];
  }

  return (data as Dentist[]) ?? [];
}

export async function getDentistCount(): Promise<number> {
  const { count, error } = await supabase
    .from("dentists")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error("Failed to count dentists:", error);
    return 0;
  }

  return count ?? 0;
}

export async function getDentistOptions() {
  const { data, error } = await supabase
    .from("dentists")
    .select("id, full_name")
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
  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to fetch dentist:", error);
    return null;
  }

  return data as Dentist;
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
  const { error } = await supabase
    .from("dentists")
    .insert(dentist);

  if (error) {
    throw error;
  }
}

export async function updateDentist(
  id: string,
  dentist: Partial<Dentist>
) {
  const { error } = await supabase
    .from("dentists")
    .update(dentist)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deleteDentist(id: string) {
  const { error } = await supabase
    .from("dentists")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function toggleDentistStatus(
  id: string,
  active: boolean
) {
  const { error } = await supabase
    .from("dentists")
    .update({ active })
    .eq("id", id);

  if (error) {
    throw error;
  }
}