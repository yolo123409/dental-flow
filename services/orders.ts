import { supabase } from "@/lib/supabase";

export async function getOrderCount() {
  const { count } = await supabase
    .from("orders")
    .select("*", {
      count: "exact",
      head: true,
    });

  return count ?? 0;
}