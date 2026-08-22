// Shared env loading for backup/DR scripts. Never logs secret values -
// only booleans/derived, non-secret facts (hostnames, bucket names).
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

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

/**
 * The restore-test Supabase project's public URL (e.g.
 * https://<ref>.supabase.co), distinct from RESTORE_TEST_DB_URL (its
 * Postgres pooler connection string). Needed because Session Pooler
 * hostnames are region-based (e.g. aws-0-eu-west-1.pooler.supabase.com)
 * and do NOT contain the project ref, so project identity can only be
 * established from the project URL, not the pooler hostname.
 */
export function getRestoreTestSupabaseUrl() {
  return required("RESTORE_TEST_SUPABASE_URL");
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

/**
 * Extracts the project ref from a Supabase project URL
 * (https://<ref>.supabase.co -> <ref>). NOT safe to use on a pooler
 * connection string's hostname - Session/Transaction pooler hostnames
 * are region-based (e.g. aws-0-eu-west-1.pooler.supabase.com) and do
 * not contain the project ref at all, which is exactly the bug this
 * replaces (see assertDistinctProjects below).
 */
export function projectRefFromSupabaseUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

/**
 * Connects to a Postgres URL and returns its system_identifier - a
 * globally unique 64-bit value Postgres assigns to every cluster at
 * initdb time (see pg_control_system()). This is the one live signal
 * confirmed (by actually querying both real projects) to reliably
 * differ between two distinct Supabase projects reached through the
 * same regional pooler:
 *   - current_user is USELESS for this: Supabase's Supavisor pooler
 *     normalizes every session's role to a plain "postgres", stripping
 *     the "postgres.<project-ref>" qualifier used only for routing -
 *     confirmed live, both projects report identical current_user.
 *   - the pooler hostname is USELESS for this: it is assigned by
 *     region/load-balancing, not by project, so two unrelated projects
 *     in the same region can share the exact same pooler hostname.
 *   - system_identifier is set once per physical cluster and is not
 *     derived from, or exposed in, the connection string at all -
 *     confirmed live, the two projects report different values.
 * A successful call also proves the URL is reachable, so callers don't
 * need a separate reachability probe.
 */
export async function fetchClusterIdentity(pgUrl) {
  const client = new pg.Client({ connectionString: pgUrl, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    const { rows } = await client.query("select system_identifier::text as id from pg_control_system()");
    return rows[0].id;
  } finally {
    await client.end();
  }
}

/**
 * The full safety gate a restore (or the daily backup's preflight)
 * must pass before proceeding. Two independent proofs, both required:
 *
 *   1. Declared identity: NEXT_PUBLIC_SUPABASE_URL and
 *      RESTORE_TEST_SUPABASE_URL name different project refs. Cheap,
 *      no network call - catches an operator pointing both at the same
 *      project URL by mistake.
 *   2. Actual identity: SUPABASE_DB_URL and RESTORE_TEST_DB_URL are
 *      live-connected to and their system_identifier values compared.
 *      This is the property that actually matters - it proves the two
 *      *connection strings* (not just the two project URLs typed
 *      alongside them) really do reach two different physical
 *      clusters, which a pooler-hostname comparison could never prove
 *      (see fetchClusterIdentity above for why).
 *
 * Throws a specific, actionable error on any failure. Never includes a
 * connection string, password, or other secret in its output or
 * thrown message - only project refs (public, already visible in
 * NEXT_PUBLIC_SUPABASE_URL) and system_identifier values (an internal
 * Postgres cluster fingerprint, not a credential).
 */
export async function assertDistinctProjects({ prodDbUrl, prodSupabaseUrl, restoreDbUrl, restoreSupabaseUrl }) {
  const prodRef = projectRefFromSupabaseUrl(prodSupabaseUrl);
  const restoreRef = projectRefFromSupabaseUrl(restoreSupabaseUrl);
  if (!prodRef || !restoreRef || prodRef === restoreRef) {
    throw new Error(
      `SAFETY CHECK FAILED: NEXT_PUBLIC_SUPABASE_URL (ref=${prodRef ?? "unparseable"}) and RESTORE_TEST_SUPABASE_URL (ref=${restoreRef ?? "unparseable"}) must name two different, valid Supabase projects. Refusing to proceed.`
    );
  }

  const [prodIdentity, restoreIdentity] = await Promise.all([
    fetchClusterIdentity(prodDbUrl),
    fetchClusterIdentity(restoreDbUrl),
  ]);

  if (prodIdentity === restoreIdentity) {
    throw new Error(
      "SAFETY CHECK FAILED: SUPABASE_DB_URL and RESTORE_TEST_DB_URL are connected to the SAME physical Postgres cluster (matching system_identifier), despite different declared project URLs. Refusing to proceed."
    );
  }

  return { prodRef, restoreRef, prodIdentity, restoreIdentity };
}
