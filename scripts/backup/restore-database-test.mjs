// Phase 3/4/5 - Restore test in an isolated environment.
//
// SAFETY: refuses to run unless SUPABASE_DB_URL and RESTORE_TEST_DB_URL
// are proven, live, to be different physical Postgres clusters (see
// lib/env.mjs assertDistinctProjects) - verified via each cluster's own
// system_identifier, NOT by comparing pooler hostnames (Session/
// Transaction pooler hostnames are region-based, e.g.
// aws-0-eu-west-1.pooler.supabase.com, and do not contain the project
// ref, so two unrelated projects in the same region can share one).
// Never writes to SUPABASE_DB_URL. Downloads the latest backup from
// R2, restores schema + data into RESTORE_TEST_DB_URL only, then
// verifies structural fidelity, row counts, multi-branch relationships,
// and financial integrity. Prints a PASS/FAIL report; never logs row
// content, only counts/booleans/aggregates.
//
// TRIGGERS DURING DATA LOAD: several tables carry application-side
// AFTER INSERT triggers with side effects (e.g. clinic_invoices/
// clinic_payments/clinic_expenses each post entries into
// clinic_ledger_entries). A 2026-08-22 real restore drill found that
// restoring their backed-up rows via plain INSERT re-fires those
// triggers, duplicating ledger entries on top of the ones the backup
// already contains (production: 16 rows/206,400.00; restored:
// 72 rows/616,640.00 - a real, confirmed defect, not hypothetical).
// Fixed by disabling only USER triggers (ALTER TABLE ... DISABLE
// TRIGGER USER) on every target table before the data-load phase, then
// re-enabling them in a finally block - not DISABLE TRIGGER ALL, which
// would also blind Postgres's own internal FK-constraint-enforcement
// triggers. Referential integrity therefore stays enforced by Postgres
// itself throughout the load, and every trigger is guaranteed back to
// its normal enabled state before this script exits, success or not.
//
// POST-RESTORE RECONCILIATION: row-count verification now runs a live
// SELECT COUNT(*) per table against the restored database, not the
// script's own tally of rows it inserted - the earlier version's blind
// spot (it could report "counts match" while a trigger silently added
// or duplicated rows behind its back, which is exactly what happened).
// Financial verification separately compares the restored ledger's
// SUM(debit)/SUM(credit) against the true backup totals (computed from
// the backup's own in-memory row data, not the backup file itself),
// not merely debit=credit self-consistency - a duplicated-but-still-
// balanced ledger passes the old check and fails this one.
import zlib from "node:zlib";
import crypto from "node:crypto";
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "./lib/env.mjs";
import { r2List, r2Get } from "./lib/r2.mjs";
import { decryptBuffer } from "./lib/crypto.mjs";
import {
  listTables,
  listFunctions,
  listPolicies,
  listRlsStatus,
  listConstraints,
  listIndexes,
  listExtensions,
  listForeignKeys,
} from "./lib/introspect.mjs";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

async function latestBackup() {
  const metas = await r2List("db/");
  const metaObjs = metas.filter((o) => o.Key.endsWith(".meta.json"));
  if (metaObjs.length === 0) throw new Error("No database backup metadata found in R2 - run backup-database.mjs first");
  metaObjs.sort((a, b) => (a.Key < b.Key ? 1 : -1));
  const metaKey = metaObjs[0].Key;
  const meta = JSON.parse((await r2Get(metaKey)).toString("utf8"));
  return meta;
}

function deserializeValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if (value && typeof value === "object" && "__bytea_base64__" in value) {
    return Buffer.from(value.__bytea_base64__, "base64");
  }
  if (dataType === "json" || dataType === "jsonb") return JSON.stringify(value);
  return value;
}

async function insertData(client, tableOrder, data, columnTypes) {
  const rowCounts = {};
  for (const table of tableOrder) {
    const rows = data[table] || [];
    const cols = (columnTypes[table] || []).map((c) => c.column_name);
    if (rows.length === 0 || cols.length === 0) {
      rowCounts[table] = 0;
      continue;
    }
    const typeByCol = new Map((columnTypes[table] || []).map((c) => [c.column_name, c.data_type]));
    const colList = cols.map((c) => `"${c}"`).join(", ");

    // Batch multiple rows per INSERT (one round-trip per batch instead
    // of one per row - the difference between minutes and hours for a
    // table with tens of thousands of rows, e.g. the ICD-10-CM
    // reference set in clinical_codes). Postgres allows up to 65535
    // bound parameters per query; stay well under that.
    const batchSize = Math.max(1, Math.min(500, Math.floor(60000 / cols.length)));
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const rowPlaceholders = batch.map((row, rowIdx) => {
        const placeholders = cols.map((c, colIdx) => {
          values.push(deserializeValue(row[c], typeByCol.get(c)));
          return `$${rowIdx * cols.length + colIdx + 1}`;
        });
        return `(${placeholders.join(", ")})`;
      });
      const insertSql = `insert into "public"."${table}" (${colList}) values ${rowPlaceholders.join(", ")}`;
      await client.query(insertSql, values);
      inserted += batch.length;
    }
    rowCounts[table] = inserted;
    if (rows.length > 1000) console.log(`  ${table}: ${inserted} rows inserted`);
  }
  return rowCounts;
}

/**
 * DISABLE/ENABLE TRIGGER USER, not ALL: USER excludes Postgres's own
 * internal triggers (foreign-key constraint enforcement among them), so
 * referential integrity stays enforced by the database itself for the
 * whole data-load phase - only application-defined triggers (ledger-
 * posting side effects, insurance/code-system validation of data that
 * was already valid when the backup captured it) are skipped. A no-op,
 * not an error, on a table with no user triggers.
 */
async function disableUserTriggers(client, tableOrder) {
  for (const table of tableOrder) {
    await client.query(`alter table "public"."${table}" disable trigger user`);
  }
}

async function enableUserTriggers(client, tableOrder) {
  for (const table of tableOrder) {
    await client.query(`alter table "public"."${table}" enable trigger user`);
  }
}

function diffSets(a, b, label) {
  const setA = new Set(a);
  const setB = new Set(b);
  const missing = [...setA].filter((x) => !setB.has(x));
  const extra = [...setB].filter((x) => !setA.has(x));
  record(`${label} match`, missing.length === 0 && extra.length === 0, missing.length || extra.length ? `missing=[${missing.join(",")}] extra=[${extra.join(",")}]` : `count=${setB.size}`);
}

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();
  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: restore target is a live-verified, different Postgres cluster than production (not just a different pooler hostname).\n");

  const meta = await latestBackup();
  console.log(`Restoring backup run ${meta.runId} (${meta.tableCount} tables, ${meta.totalRows} rows, ${meta.sizeBytes} bytes)`);

  const raw = await r2Get(meta.r2Key);
  const gzipped = meta.encrypted ? decryptBuffer(raw) : raw;
  const json = zlib.gunzipSync(gzipped).toString("utf8");
  const payload = JSON.parse(json);

  const downloadedSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  record("Downloaded backup checksum matches metadata", downloadedSha256 === meta.sha256);

  const client = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log("Connected to restore-test database.\n");

  const timings = {};
  try {
    console.log("Resetting target schema (safe: verified above to be the disposable restore-test project, never production)...");
    await client.query(`drop schema public cascade; create schema public; grant all on schema public to postgres; grant all on schema public to public;`);

    console.log("Applying schema DDL...");
    const t0 = Date.now();
    try {
      await client.query(payload.schema.schemaSql);
      record("Schema DDL applied without error", true);
    } catch (e) {
      record("Schema DDL applied without error", false, e.message);
      throw e;
    }
    timings.schemaMs = Date.now() - t0;

    console.log("\n--- Structural verification (restored DB vs backup snapshot) ---");
    // Run immediately after DDL, before any constraints are touched for
    // the data-restore step below, so this reflects exactly what the
    // schema DDL produced. Sequential, not Promise.all - see
    // backup-database.mjs for why a single pg.Client can't safely run
    // concurrent queries.
    const tables = await listTables(client);
    const functions = await listFunctions(client);
    const policies = await listPolicies(client);
    const rlsStatus = await listRlsStatus(client);
    const constraints = await listConstraints(client);
    const indexes = await listIndexes(client);
    const extensions = await listExtensions(client);
    const foreignKeys = await listForeignKeys(client);

    diffSets(payload.tableOrder, tables, "Tables");
    diffSets(
      payload.schema.liveIntrospection.functions.map((f) => f.proname),
      functions.map((f) => f.proname),
      "Functions/RPCs"
    );
    diffSets(
      payload.schema.liveIntrospection.policies.map((p) => `${p.tablename}.${p.policyname}`),
      policies.map((p) => `${p.tablename}.${p.policyname}`),
      "RLS policies"
    );
    diffSets(
      payload.schema.liveIntrospection.rlsStatus.filter((r) => r.rls_enabled).map((r) => r.table),
      rlsStatus.filter((r) => r.rls_enabled).map((r) => r.table),
      "RLS-enabled tables"
    );
    diffSets(
      payload.schema.liveIntrospection.constraints.map((c) => c.conname),
      constraints.map((c) => c.conname),
      "Constraints"
    );
    diffSets(
      payload.schema.liveIntrospection.indexes.map((i) => i.indexname),
      indexes.map((i) => i.indexname),
      "Indexes"
    );
    diffSets(
      payload.schema.liveIntrospection.foreignKeys.map((f) => f.conname),
      foreignKeys.map((f) => f.conname),
      "Foreign keys"
    );

    // A small number of tables (orders, profiles, purchases) have a FK
    // to auth.users(id). auth.users is deliberately NOT part of this
    // backup - it holds real emails and password hashes, and restoring
    // it would violate the no-credential/no-PII-exposure constraint on
    // this task. Every Supabase project auto-provisions an empty
    // auth.users table, so the constraint itself creates fine (already
    // verified above), but inserting real public-schema rows against an
    // empty auth.users fails referential integrity. This is an
    // inherent, correct consequence of scoping the backup to `public`
    // only - not a defect - so these specific constraints are dropped
    // for the data-restore step and reported explicitly, not silently
    // worked around.
    const { rows: crossSchemaFks } = await client.query(`
      select c.conname, c.conrelid::regclass::text as "table"
      from pg_constraint c
      join pg_class t on t.oid = c.confrelid
      join pg_namespace tn on tn.oid = t.relnamespace
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and tn.nspname != 'public'
    `);
    for (const fk of crossSchemaFks) {
      await client.query(`alter table "public".${fk.table.replace(/^public\./, "")} drop constraint "${fk.conname}"`);
    }
    record(
      "Cross-schema FKs to auth.users identified and dropped before data restore (expected, documented, not restored by design)",
      true,
      crossSchemaFks.map((f) => `${f.table}.${f.conname}`).join(", ") || "none found"
    );

    console.log("\nDisabling application-side (USER) triggers on restore-target tables before data load...");
    await disableUserTriggers(client, payload.tableOrder);
    let restoredRowCounts;
    try {
      console.log("Inserting data...");
      const t1 = Date.now();
      restoredRowCounts = await insertData(client, payload.tableOrder, payload.data, payload.columnTypes);
      timings.dataMs = Date.now() - t1;
    } finally {
      await enableUserTriggers(client, payload.tableOrder);
      console.log("Re-enabled all application-side triggers on restore-target tables.");
    }

    console.log("\n--- Post-restore reconciliation (live COUNT(*) per table, not self-reported insert counts) ---");
    let rowCountMismatches = [];
    for (const table of payload.tableOrder) {
      const expected = payload.rowCounts[table] ?? 0;
      const { rows: cRows } = await client.query(`select count(*)::int as n from public."${table}"`);
      const actual = cRows[0].n;
      if (expected !== actual) {
        rowCountMismatches.push(`${table}: expected ${expected}, live=${actual} (script-inserted ${restoredRowCounts[table] ?? 0})`);
      }
    }
    record(
      "Live row counts match backup for every table (post-restore reconciliation)",
      rowCountMismatches.length === 0,
      rowCountMismatches.join("; ")
    );

    console.log("\n--- Named critical-table presence checks ---");
    const criticalTables = [
      "organizations",
      "organization_users",
      "clinics",
      "clinic_users",
      "patients",
      "appointments",
      "dentists",
      "clinic_invoices",
      "clinic_ledger_entries",
      "clinic_ledger_transactions",
      "clinic_expenses",
      "staff_invitations",
    ];
    const tableSet = new Set(tables);
    for (const t of criticalTables) {
      record(`Table "${t}" exists`, tableSet.has(t));
    }
    record(
      "AI receptionist tables correctly absent (removed by migration 0069)",
      !tableSet.has("ai_conversations") && !tableSet.has("ai_receptionists")
    );

    console.log("\n--- Phase 4: multi-branch relationship checks ---");
    const orgCount = (await client.query(`select count(*)::int as n from public.organizations`)).rows[0].n;
    const orgUserCount = (await client.query(`select count(*)::int as n from public.organization_users`)).rows[0].n;
    const clinicCount = (await client.query(`select count(*)::int as n from public.clinics`)).rows[0].n;
    const clinicUserCount = (await client.query(`select count(*)::int as n from public.clinic_users`)).rows[0].n;
    record("organizations row count matches backup", orgCount === (payload.rowCounts.organizations ?? 0), `restored=${orgCount}`);
    record("organization_users row count matches backup", orgUserCount === (payload.rowCounts.organization_users ?? 0), `restored=${orgUserCount}`);
    record("clinics row count matches backup", clinicCount === (payload.rowCounts.clinics ?? 0), `restored=${clinicCount}`);
    record("clinic_users row count matches backup", clinicUserCount === (payload.rowCounts.clinic_users ?? 0), `restored=${clinicUserCount}`);

    const orphanedClinics = (
      await client.query(
        `select count(*)::int as n from public.clinics c where c.organization_id is not null and not exists (select 1 from public.organizations o where o.id = c.organization_id)`
      )
    ).rows[0].n;
    record("No clinics reference a missing organization", orphanedClinics === 0, `orphaned=${orphanedClinics}`);

    console.log("\n--- Phase 5: financial integrity checks ---");
    // clinic_invoices/clinic_expenses row counts are covered by the
    // general post-restore reconciliation above; this section adds
    // ledger-specific checks that a plain row count can't express.
    const ledgerRowCount = (await client.query(`select count(*)::int as n from public.clinic_ledger_entries`)).rows[0].n;
    record(
      "clinic_ledger_entries row count matches backup exactly",
      ledgerRowCount === (payload.rowCounts.clinic_ledger_entries ?? 0),
      `restored=${ledgerRowCount} backup=${payload.rowCounts.clinic_ledger_entries ?? 0}`
    );

    const ledgerCols = (
      await client.query(
        `select column_name from information_schema.columns where table_schema='public' and table_name='clinic_ledger_entries'`
      )
    ).rows.map((r) => r.column_name);
    const debitCol = ledgerCols.find((c) => /debit/i.test(c));
    const creditCol = ledgerCols.find((c) => /credit/i.test(c));
    if (debitCol && creditCol) {
      const liveSums = (
        await client.query(
          `select coalesce(sum("${debitCol}"),0)::numeric as total_debit, coalesce(sum("${creditCol}"),0)::numeric as total_credit from public.clinic_ledger_entries`
        )
      ).rows[0];
      record(
        "Total debits equal total credits in restored ledger (internal consistency)",
        liveSums.total_debit === liveSums.total_credit,
        `debit=${liveSums.total_debit} credit=${liveSums.total_credit}`
      );

      // The internal-consistency check above is necessary but not
      // sufficient - a duplicated ledger (the 2026-08-22 defect) is
      // still internally balanced, since each duplicated posting is
      // itself a balanced pair. Compare against the backup's *true*
      // totals instead: computed from the backup's own in-memory row
      // data (already downloaded, never re-reading the backup file)
      // via a Postgres-side numeric sum, not JS floating-point math,
      // to avoid precision loss on currency values.
      const backupLedgerRows = payload.data.clinic_ledger_entries || [];
      const backupDebits = backupLedgerRows.map((r) => r[debitCol] ?? "0");
      const backupCredits = backupLedgerRows.map((r) => r[creditCol] ?? "0");
      const expectedSums = (
        await client.query(
          `select coalesce(sum(x.d),0)::numeric as total_debit, coalesce(sum(x.c),0)::numeric as total_credit from unnest($1::numeric[], $2::numeric[]) as x(d, c)`,
          [backupDebits, backupCredits]
        )
      ).rows[0];
      record(
        "Restored ledger debit total matches the backup's true total (not just internally balanced)",
        liveSums.total_debit === expectedSums.total_debit,
        `restored=${liveSums.total_debit} backup=${expectedSums.total_debit}`
      );
      record(
        "Restored ledger credit total matches the backup's true total (not just internally balanced)",
        liveSums.total_credit === expectedSums.total_credit,
        `restored=${liveSums.total_credit} backup=${expectedSums.total_credit}`
      );
    } else {
      record("Total debits equal total credits in restored ledger (internal consistency)", false, `could not locate debit/credit columns on clinic_ledger_entries (found: ${ledgerCols.join(",")})`);
    }

    const orphanedLedgerEntries = (
      await client.query(
        `select count(*)::int as n from public.clinic_ledger_entries e where e.transaction_id is not null and not exists (select 1 from public.clinic_ledger_transactions t where t.id = e.transaction_id)`
      )
    ).rows[0].n;
    record(
      "No clinic_ledger_entries reference a missing clinic_ledger_transactions row",
      orphanedLedgerEntries === 0,
      `orphaned=${orphanedLedgerEntries}`
    );

    console.log(`\nTimings: schema=${timings.schemaMs}ms, data=${timings.dataMs}ms`);
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`FAILED CHECKS: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
