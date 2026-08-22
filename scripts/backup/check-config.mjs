// Preflight: verifies backup/DR credentials are present, well-formed, and
// point at the right places - WITHOUT ever printing secret values.
// Exits non-zero on any check failure.
import { getProdDbUrl, getRestoreTestDbUrl, getR2Config, assertDistinctProjects, safeHost } from "./lib/env.mjs";
import { r2Client } from "./lib/r2.mjs";
import { HeadBucketCommand } from "@aws-sdk/client-s3";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
  if (!ok) failed = true;
}

const prodUrl = getProdDbUrl();
const restoreUrl = getRestoreTestDbUrl();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let prodRef = null;
try {
  prodRef = new URL(supabaseUrl).hostname.split(".")[0];
} catch {}

const prodHost = safeHost(prodUrl);
const restoreHost = safeHost(restoreUrl);

check("SUPABASE_DB_URL parses as a Postgres URL", /^postgres(ql)?:$/.test(new URL(prodUrl).protocol));
check(
  "SUPABASE_DB_URL host matches the app's configured production project ref",
  !!prodRef && prodHost.includes(prodRef),
  `host=${prodHost}`
);
check("RESTORE_TEST_DB_URL parses as a Postgres URL", /^postgres(ql)?:$/.test(new URL(restoreUrl).protocol));

try {
  assertDistinctProjects(prodUrl, restoreUrl);
  check("RESTORE_TEST_DB_URL is a DIFFERENT project than SUPABASE_DB_URL", true, `${prodHost} != ${restoreHost}`);
} catch {
  check("RESTORE_TEST_DB_URL is a DIFFERENT project than SUPABASE_DB_URL", false, "SAME HOST DETECTED");
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
