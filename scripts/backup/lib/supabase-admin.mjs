import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClientConfig, getRestoreTestSupabaseAdminClientConfig } from "./env.mjs";

let client = null;
export function supabaseAdmin() {
  if (client) return client;
  const cfg = getSupabaseAdminClientConfig();
  client = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });
  return client;
}

let restoreTestClient = null;
/** Admin client for the disposable restore-test project's Storage API - never production. */
export function restoreTestSupabaseAdmin() {
  if (restoreTestClient) return restoreTestClient;
  const cfg = getRestoreTestSupabaseAdminClientConfig();
  restoreTestClient = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });
  return restoreTestClient;
}
