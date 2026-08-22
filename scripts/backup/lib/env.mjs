// Shared env loading for backup/DR scripts. Never logs secret values -
// only booleans/derived, non-secret facts (hostnames, bucket names).
import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^"|"$/g, "");
    }
  }
}

loadDotEnvLocal();

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function getProdDbUrl() {
  return required("SUPABASE_DB_URL");
}

export function getRestoreTestDbUrl() {
  return required("RESTORE_TEST_DB_URL");
}

export function getSupabaseAdminClientConfig() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getR2Config() {
  return {
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET_NAME"),
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  };
}

export function getBackupEncryptionKey() {
  // Optional: if unset, callers must fall back to documenting the gap
  // rather than fabricating encryption. See docs/DISASTER_RECOVERY.md.
  return process.env.BACKUP_ENCRYPTION_KEY || null;
}

/** Host string only (no credentials, no db name) - safe to log. */
export function safeHost(pgUrl) {
  try {
    return new URL(pgUrl).hostname;
  } catch {
    return "(unparseable)";
  }
}

/** Verifies the two DB URLs point at different Supabase projects. Throws if not. */
export function assertDistinctProjects(prodUrl, restoreUrl) {
  const prodHost = safeHost(prodUrl);
  const restoreHost = safeHost(restoreUrl);
  if (!prodHost || !restoreHost || prodHost === restoreHost) {
    throw new Error(
      "SAFETY CHECK FAILED: SUPABASE_DB_URL and RESTORE_TEST_DB_URL resolve to the same host. Refusing to proceed."
    );
  }
  return { prodHost, restoreHost };
}
