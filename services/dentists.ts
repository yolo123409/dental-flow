import { supabase } from "@/lib/supabase";

export async function getDentists() {
  const { data, error } = await supabase
    .from("dentists")
    .select("*")
    .order("first_name");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function getDentistCount() {
  const { count, error } = await supabase
    .from("dentists")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function getDentistOptions() {
  const { data, error } = await supabase
    .from("dentists")
    .select("id, full_name")
    .order("full_name");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function createDentist(dentist: {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
}) {
  const { error } = await supabase
    .from("dentists")
    .insert(dentist);

  if (error) {
    throw error;
  }
}

export async function updateDentist(
  id: string,
  dentist: Record<string, unknown>
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