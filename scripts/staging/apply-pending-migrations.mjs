// FIN-4.6 — applies migrations not yet live in production onto staging,
// so CI can behaviorally test a new migration BEFORE it ever touches
// production, not just after.
//
// WHY THIS EXISTS: `npm run staging:sync-schema` rebuilds staging from
// PRODUCTION'S CURRENT live schema via catalog introspection - so a
// brand-new migration file added in a branch, not yet applied to
// production, is invisible to a freshly-synced staging database. This
// script closes that gap by layering exactly the migrations a branch
// adds - and only those - on top of the synced baseline.
//
// HOW "pending" IS DETERMINED: supabase/migrations/.production-baseline
// records the last migration number verified live in production (see
// that file's own history for when it was last bumped - it only moves
// when a migration is actually applied to production, a separate,
// human-gated act; this script never writes to it). Every migration
// file numbered higher than that baseline is "pending" and gets applied
// here, in order. This is a deliberately simple, auditable marker file
// rather than a database-side tracking table - production has never had
// a migration-tracking table (every migration in this repo's history
// was applied by hand against a raw connection), and adding one now
// would itself be a production schema change this phase's brief didn't
// ask for and shouldn't invent silently.
//
// SAFETY: this script has no production target at all - not a flag, not
// an env var, nothing. It only ever connects to RESTORE_TEST_DB_URL. The
// assertDistinctProjects gate below is defense-in-depth (matching every
// other write-capable script in this repo), not the only thing standing
// between this script and production.
//
// Run `npm run staging:sync-schema` first - this script does not do
// that itself (same separation-of-concerns reasoning as
// db-integration-tests.mjs: syncing the baseline and layering pending
// migrations are different, independently-useful operations).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const baselineFile = path.join(migrationsDir, ".production-baseline");

function migrationNumber(filename) {
  const m = filename.match(/^(\d+)_/);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();
  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: target is a live-verified, different Postgres cluster than production.\n");

  const baseline = parseInt(fs.readFileSync(baselineFile, "utf8").trim(), 10);
  if (!Number.isFinite(baseline)) {
    throw new Error(`Could not parse a migration number from ${baselineFile}.`);
  }

  const pending = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, num: migrationNumber(f) }))
    .filter((m) => m.num !== null && m.num > baseline)
    .sort((a, b) => a.num - b.num);

  console.log(`Production baseline: migration ${String(baseline).padStart(4, "0")}. Found ${pending.length} pending migration(s) not yet live in production.`);

  if (pending.length === 0) {
    console.log("Nothing to apply. Staging already matches every migration known to be live in production.");
    return;
  }

  const client = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log("Connected to staging (restore-test project).\n");

  try {
    for (const { file } of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query(sql);
        console.log("OK");
      } catch (err) {
        console.log("FAILED");
        console.error(`\n${file} failed against staging:\n${err.message}`);
        console.error("\nStopping - no further pending migrations were attempted. This migration must not be applied to production until this failure is understood and fixed.");
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\nAll ${pending.length} pending migration(s) applied to staging successfully.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
