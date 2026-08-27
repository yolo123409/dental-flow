// FIN-4.1 — Staging schema sync.
//
// PROBLEM: every FIN-3 live-verification test in this codebase's history
// ran directly against production, made safe only by manual
// BEGIN/ROLLBACK transaction discipline — never by real environment
// isolation. There was no separate database to point tests, migrations,
// or local development at.
//
// This script does NOT provision a new environment (that requires
// external Supabase account action — see docs/ENVIRONMENTS.md for the
// manual steps to do that). Instead it repurposes infrastructure that
// already exists and is already proven isolated: the disaster-recovery
// "restore-test" Supabase project (RESTORE_TEST_DB_URL /
// RESTORE_TEST_SUPABASE_URL), live-verified before every use — via
// Postgres's own system_identifier, not just a different project URL —
// to be a genuinely distinct physical cluster from production
// (scripts/backup/lib/env.mjs assertDistinctProjects, the exact same
// gate restore-database-test.mjs uses).
//
// UNLIKE a DR restore drill, this never touches a row of real data:
// it reads production's schema via live catalog introspection (the same
// buildSchemaSql() the backup pipeline uses — see lib/ddl-generator.mjs)
// and applies ONLY that DDL to the restore-test project, after dropping
// and recreating its public schema exactly the way restore-database-
// test.mjs already does. No data is read from production's tables, and
// no data is written to the target beyond what CREATE TABLE/TRIGGER/
// POLICY statements themselves produce (i.e. none). Safe to run
// repeatedly; safe to run between or alongside DR drills — a DR drill
// already unconditionally drops and rebuilds this same schema at the
// start of every run, so leaving it schema-populated-but-empty here
// changes nothing about that script's own behavior.
//
// Run this after adding a new migration and before applying it to
// production, then point RESTORE_TEST_DB_URL-based integration tests
// (scripts/staging/*.test.mjs, see FIN-4.2) at the synced project to
// verify the migration before it ever touches real data.
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";
import { listTables, listFunctions, listExtensions, listForeignKeys, topoSortTables } from "../backup/lib/introspect.mjs";
import { buildSchemaSql } from "../backup/lib/ddl-generator.mjs";

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();

  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: staging target is a live-verified, different Postgres cluster than production.\n");

  const prodClient = new pg.Client({ connectionString: prodUrl, connectionTimeoutMillis: 15000 });
  await prodClient.connect();
  console.log("Connected to production (read-only: schema introspection only, no row data read).");

  let schemaSql, tableCount, functionCount;
  try {
    const tables = await listTables(prodClient);
    const foreignKeys = await listForeignKeys(prodClient);
    const orderedTables = topoSortTables(tables, foreignKeys);
    const functions = await listFunctions(prodClient);
    const extensions = await listExtensions(prodClient);

    console.log(`Generating DDL from production's live catalog (${tables.length} tables, ${functions.length} functions)...`);
    schemaSql = await buildSchemaSql(prodClient, orderedTables, functions, extensions);
    tableCount = tables.length;
    functionCount = functions.length;
  } finally {
    await prodClient.end();
  }

  const stagingClient = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000 });
  await stagingClient.connect();
  console.log("Connected to staging (restore-test project).\n");

  try {
    console.log("Resetting staging public schema (safe: verified above to be the disposable project, never production)...");
    await stagingClient.query(`drop schema public cascade; create schema public; grant all on schema public to postgres; grant all on schema public to public;`);

    console.log("Applying production's current schema DDL to staging (structure only, zero data rows)...");
    await stagingClient.query(schemaSql);

    const { rows: tableRows } = await stagingClient.query(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public'`
    );
    const { rows: rowCountRows } = await stagingClient.query(`
      select coalesce(sum(n_live_tup), 0)::bigint as total
      from pg_stat_user_tables
      where schemaname = 'public'
    `);

    console.log(`\nStaging schema applied: ${tableRows[0].n} tables, ${functionCount} functions (production had ${tableCount} tables).`);
    console.log(`Estimated live row count in staging: ${rowCountRows[0].total} (expect 0 — this script never writes data).`);

    if (Number(rowCountRows[0].total) !== 0) {
      console.warn("WARNING: staging is not empty after a schema-only sync. Investigate before trusting it as a clean staging target.");
      process.exitCode = 1;
    } else {
      console.log("\nStaging is schema-synced with production and contains zero rows. Safe to seed with synthetic test data (see FIN-4.2).");
    }
  } finally {
    await stagingClient.end();
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
