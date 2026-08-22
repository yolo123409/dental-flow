// Phase 1/2/4 - Database backup generation + off-site upload.
//
// No pg_dump/psql/Docker are available in the execution environment
// (verified), so this connects directly to Postgres (via `pg`, the
// standard Node Postgres driver) and builds the backup from two real
// sources instead of shelling out to pg_dump:
//
//   1. SCHEMA - real DDL generated from LIVE catalog introspection
//      (pg_catalog/information_schema - see lib/ddl-generator.mjs):
//      extensions, enums, tables/columns, constraints, indexes,
//      triggers, functions, table grants, RLS enable flags, and
//      policies. NOT sourced from supabase/migrations/: verified that
//      several foundational tables (clinics, patients, dentists,
//      appointments, clinic_users, profiles) predate migration tracking
//      in this repo and are never CREATE TABLE'd by any migration file,
//      so a migrations-only bundle would fail to restore. Live
//      introspection reflects whatever is actually running in
//      production regardless of migration history.
//   2. DATA - every row of every public-schema table, read directly via
//      SELECT and serialized to JSON.
//
// Only the `public` schema is touched - Supabase-managed internal
// schemas (auth, storage, realtime, etc.) are deliberately excluded.
//
// Output is a single gzip-compressed JSON document, optionally
// encrypted client-side (AES-256-GCM) when BACKUP_ENCRYPTION_KEY is
// set, uploaded to the private R2 bucket, and verified via a
// post-upload HEAD request. Exits non-zero on any failure. Never logs
// credentials or row data - only counts/sizes/checksums.
import zlib from "node:zlib";
import crypto from "node:crypto";
import pg from "pg";
import { getProdDbUrl } from "./lib/env.mjs";
import {
  listTables,
  listColumns,
  listForeignKeys,
  listFunctions,
  listIndexes,
  listConstraints,
  listPolicies,
  listRlsStatus,
  listExtensions,
  dbStats,
  topoSortTables,
} from "./lib/introspect.mjs";
import {
  extensionsDDL,
  listCustomEnums,
  enumDDL,
  tableDDL,
  listSequenceDefaults,
  listConstraintsOrdered,
  listNonConstraintIndexes,
  listTriggers,
  listTableGrants,
  grantsDDL,
  policyDDL,
} from "./lib/ddl-generator.mjs";
import { r2Put, r2Head } from "./lib/r2.mjs";
import { encryptionAvailable, encryptBuffer } from "./lib/crypto.mjs";

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const ENCRYPT = encryptionAvailable();

function serializeValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if (dataType === "json" || dataType === "jsonb") return value; // kept as JS value; JSON.stringify of the whole row handles it
  if (Buffer.isBuffer(value)) return { __bytea_base64__: value.toString("base64") };
  return value;
}

async function buildSchemaSql(client, tables, functions, extensions) {
  const parts = [];

  const extDdl = extensionsDDL(extensions);
  if (extDdl) parts.push("-- ==== extensions ====", extDdl);

  const enums = await listCustomEnums(client);
  if (enums.length > 0) parts.push("-- ==== enums ====", enumDDL(enums));

  const seqDefaults = await listSequenceDefaults(client);
  if (seqDefaults.length > 0) {
    console.warn(
      `WARNING: ${seqDefaults.length} column(s) use a plain sequence default (not identity) - verify these restore correctly: ${seqDefaults
        .map((s) => `${s.table}.${s.column_name}`)
        .join(", ")}`
    );
  }

  parts.push("-- ==== tables ====");
  for (const t of tables) {
    parts.push(await tableDDL(client, t));
  }

  const constraints = await listConstraintsOrdered(client);
  if (constraints.length > 0) {
    parts.push(
      "-- ==== constraints ====",
      constraints.map((c) => `alter table public."${c.table.replace(/^public\./, "").replace(/"/g, "")}" add constraint "${c.conname}" ${c.definition};`).join("\n")
    );
  }

  const indexes = await listNonConstraintIndexes(client);
  if (indexes.length > 0) {
    parts.push("-- ==== indexes ====", indexes.map((i) => `${i.indexdef};`).join("\n"));
  }

  parts.push("-- ==== functions ====", functions.map((f) => f.definition + ";").join("\n\n"));

  const triggers = await listTriggers(client);
  if (triggers.length > 0) {
    parts.push("-- ==== triggers ====", triggers.map((t) => `${t.definition};`).join("\n"));
  }

  const grants = await listTableGrants(client);
  if (grants.length > 0) parts.push("-- ==== grants ====", grantsDDL(grants));

  const rlsStatus = await listRlsStatus(client);
  const rlsEnabledTables = rlsStatus.filter((r) => r.rls_enabled);
  if (rlsEnabledTables.length > 0) {
    parts.push(
      "-- ==== row level security ====",
      rlsEnabledTables
        .map((r) => {
          let sql = `alter table public."${r.table}" enable row level security;`;
          if (r.rls_forced) sql += `\nalter table public."${r.table}" force row level security;`;
          return sql;
        })
        .join("\n")
    );
  }

  const policies = await listPolicies(client);
  if (policies.length > 0) {
    parts.push("-- ==== policies ====", policies.map(policyDDL).join("\n"));
  }

  return parts.join("\n\n");
}

async function dumpData(client, tables) {
  const data = {};
  const rowCounts = {};
  const columnTypes = {};
  for (const table of tables) {
    const colRows = await listColumns(client, table);
    columnTypes[table] = colRows.map((c) => ({ column_name: c.column_name, data_type: c.data_type }));
    const { rows } = await client.query(`select * from "public"."${table}"`);
    const serialized = rows.map((row) => {
      const out = {};
      for (const col of colRows) {
        out[col.column_name] = serializeValue(row[col.column_name], col.data_type);
      }
      return out;
    });
    data[table] = serialized;
    rowCounts[table] = serialized.length;
  }
  return { data, rowCounts, columnTypes };
}

async function main() {
  const startedAt = Date.now();
  console.log(`Backup run ${RUN_ID} starting.`);
  console.log(`Client-side encryption: ${ENCRYPT ? "ENABLED (AES-256-GCM)" : "DISABLED (BACKUP_ENCRYPTION_KEY not set)"}`);

  const client = new pg.Client({ connectionString: getProdDbUrl(), connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log("Connected to production database.");

  try {
    const stats = await dbStats(client);
    const tables = await listTables(client);
    const foreignKeys = await listForeignKeys(client);
    const orderedTables = topoSortTables(tables, foreignKeys);

    console.log(`Introspecting schema (${tables.length} tables)...`);
    // Sequential, not Promise.all: a single pg.Client cannot safely run
    // concurrent queries (only one in-flight query at a time per
    // connection - node-postgres queues them, but relying on that is
    // deprecated and will be removed in pg@9).
    const functions = await listFunctions(client);
    const indexes = await listIndexes(client);
    const constraints = await listConstraints(client);
    const policies = await listPolicies(client);
    const rlsStatus = await listRlsStatus(client);
    const extensions = await listExtensions(client);

    console.log("Generating DDL from live catalog...");
    const schemaSql = await buildSchemaSql(client, orderedTables, functions, extensions);

    console.log("Reading table data...");
    const { data, rowCounts, columnTypes } = await dumpData(client, orderedTables);
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
    console.log(`Read ${totalRows} rows across ${orderedTables.length} tables.`);

    const payload = {
      formatVersion: 2,
      runId: RUN_ID,
      createdAt: new Date().toISOString(),
      dbStats: stats,
      tableOrder: orderedTables,
      rowCounts,
      schema: {
        schemaSql,
        liveIntrospection: { functions, indexes, constraints, policies, rlsStatus, extensions, foreignKeys },
      },
      columnTypes,
      data,
    };

    const json = JSON.stringify(payload);
    const gzipped = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const uploadBody = ENCRYPT ? encryptBuffer(gzipped) : gzipped;
    const sha256 = crypto.createHash("sha256").update(uploadBody).digest("hex");

    const ext = ENCRYPT ? "json.gz.enc" : "json.gz";
    const r2Key = `db/${RUN_ID}.${ext}`;

    console.log(`Uploading backup (${uploadBody.length} bytes) to R2 as ${r2Key}...`);
    await r2Put(r2Key, uploadBody, {
      contentType: "application/octet-stream",
      metadata: { sha256, encrypted: String(ENCRYPT), "row-count": String(totalRows), "table-count": String(orderedTables.length) },
    });

    const head = await r2Head(r2Key);
    if (!head.exists) throw new Error("Upload verification failed: object not found in R2 after PUT.");
    if (head.size !== uploadBody.length) {
      throw new Error(`Upload verification failed: size mismatch (local=${uploadBody.length} remote=${head.size}).`);
    }

    const metadata = {
      runId: RUN_ID,
      r2Key,
      createdAt: payload.createdAt,
      sha256,
      sizeBytes: uploadBody.length,
      uncompressedBytes: json.length,
      encrypted: ENCRYPT,
      tableCount: orderedTables.length,
      totalRows,
      rowCounts,
      functionCount: functions.length,
      policyCount: policies.length,
      durationMs: Date.now() - startedAt,
      dbSizeBytes: Number(stats.size_bytes),
      dbSizePretty: stats.size_pretty,
      pgVersion: stats.pg_version,
    };
    const metaKey = `db/${RUN_ID}.meta.json`;
    await r2Put(metaKey, Buffer.from(JSON.stringify(metadata, null, 2)), { contentType: "application/json" });

    console.log(`\nBackup verified in R2: ${r2Key} (sha256=${sha256.slice(0, 16)}..., size=${uploadBody.length} bytes)`);
    console.log(`Metadata: ${metaKey}`);
    console.log(`Duration: ${metadata.durationMs}ms`);
    console.log("Database backup PASSED.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FATAL: database backup failed:", e.message);
  process.exit(1);
});
