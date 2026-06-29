import { supabase } from "@/lib/supabase";

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: "patient" | "dentist";
  href: string;
}

export async function searchEverything(
  query: string
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];

  // Patients
  const { data: patients } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(5);

  patients?.forEach((patient) => {
    results.push({
      id: patient.id,
      title: `${patient.first_name} ${patient.last_name}`,
      subtitle: "Patient",
      type: "patient",
      href: `/admin/patients/${patient.id}`,
    });
  });

  // Dentists
  const { data: dentists } = await supabase
    .from("dentists")
    .select("id, full_name")
    .ilike("full_name", `%${query}%`)
    .limit(5);

  dentists?.forEach((dentist) => {
    results.push({
      id: dentist.id,
      title: dentist.full_name,
      subtitle: "Dentist",
      type: "dentist",
      href: `/admin/dentists/${dentist.id}`,
    });
  });

  return results;
}