import { supabase } from "@/lib/supabase";

export async function getDentistCount() {
  const { count } = await supabase
    .from("dentists")
    .select("*", {
      count: "exact",
      head: true,
    });

  return count ?? 0;
}