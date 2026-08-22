// Preflight: verifies backup/DR credentials are present, well-formed, and
// point at the right places - WITHOUT ever printing secret values.
// Exits non-zero on any check failure.
import {
  getProdDbUrl,
  getRestoreTestDbUrl,
  getRestoreTestSupabaseUrl,
  getR2Config,
  fetchClusterIdentity,
  projectRefFromSupabaseUrl,
} from "./lib/env.mjs";
import { r2Client } from "./lib/r2.mjs";
import { HeadBucketCommand } from "@aws-sdk/client-s3";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
  if (!ok) failed = true;
}

const prodDbUrl = getProdDbUrl();
const restoreDbUrl = getRestoreTestDbUrl();
const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const restoreSupabaseUrl = getRestoreTestSupabaseUrl();

check("SUPABASE_DB_URL parses as a Postgres URL", /^postgres(ql)?:$/.test(new URL(prodDbUrl).protocol));
check("RESTORE_TEST_DB_URL parses as a Postgres URL", /^postgres(ql)?:$/.test(new URL(restoreDbUrl).protocol));

// Declared identity: cheap, no network - catches NEXT_PUBLIC_SUPABASE_URL
// and RESTORE_TEST_SUPABASE_URL being set to the same project by
// mistake. Session/Transaction pooler hostnames are region-based (e.g.
// aws-0-eu-west-1.pooler.supabase.com) and do NOT contain the project
// ref, so project identity is established from the *_SUPABASE_URL
// values, never from a pooler hostname.
const prodRef = projectRefFromSupabaseUrl(prodSupabaseUrl);
const restoreRef = projectRefFromSupabaseUrl(restoreSupabaseUrl);
check(
  "NEXT_PUBLIC_SUPABASE_URL and RESTORE_TEST_SUPABASE_URL declare different projects",
  !!prodRef && !!restoreRef && prodRef !== restoreRef,
  `prod=${prodRef ?? "unparseable"} restore=${restoreRef ?? "unparseable"}`
);

// Actual identity, live-verified. Each fetchClusterIdentity() call is
// its own connection attempt, so reachability and identity are proven
// (or fail) independently and are reported as separate, specific
// checks rather than one bundled catch.
let prodIdentity = null;
try {
  prodIdentity = await fetchClusterIdentity(prodDbUrl);
  check("SUPABASE_DB_URL is reachable", true);
} catch (e) {
  check("SUPABASE_DB_URL is reachable", false, e.message);
}

let restoreIdentity = null;
try {
  restoreIdentity = await fetchClusterIdentity(restoreDbUrl);
  check("RESTORE_TEST_DB_URL is reachable", true);
} catch (e) {
  check("RESTORE_TEST_DB_URL is reachable", false, e.message);
}

if (prodIdentity && restoreIdentity) {
  // The property that actually matters: not that the two pooler
  // hostnames differ (region-based, unreliable - a bug found in
  // production), but that the two connection strings genuinely reach
  // two different physical Postgres clusters. system_identifier is
  // Postgres's own globally-unique per-cluster fingerprint (see
  // lib/env.mjs#fetchClusterIdentity for how this was chosen and
  // verified live against both real projects).
  check(
    "SUPABASE_DB_URL and RESTORE_TEST_DB_URL are provably different Postgres clusters (live system_identifier)",
    prodIdentity !== restoreIdentity,
    prodIdentity === restoreIdentity ? "SAME CLUSTER DETECTED" : "verified via a live query, not by comparing pooler hostnames"
  );
} else {
  check(
    "SUPABASE_DB_URL and RESTORE_TEST_DB_URL are provably different Postgres clusters (live system_identifier)",
    false,
    "skipped - at least one connection above failed"
  );
}

const r2 = getR2Config();
check("R2_BUCKET_NAME is dentalflow-backups", r2.bucket === "dentalflow-backups", `bucket=${r2.bucket}`);

try {
  await r2Client().send(new HeadBucketCommand({ Bucket: r2.bucket }));
  check("R2 bucket is reachable with the provided credentials", true, `endpoint=${r2.accountId}.r2.cloudflarestorage.com`);
} catch (e) {
  check("R2 bucket is reachable with the provided credentials", false, `${e.name}`);
}

if (failed) {
  console.error("\nOne or more preflight checks failed. Aborting.");
  process.exit(1);
} else {
  console.log("\nAll preflight checks passed.");
}
