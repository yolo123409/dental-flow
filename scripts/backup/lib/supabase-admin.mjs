import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClientConfig } from "./env.mjs";

let client = null;
export function supabaseAdmin() {
  if (client) return client;
  const cfg = getSupabaseAdminClientConfig();
  client = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });
  return client;
}
