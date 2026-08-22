// Phase 6 - Storage backup.
//
// Supabase's database backups do NOT include Storage objects, so this is
// a deliberately separate pipeline. Walks every bucket via the
// service-role Storage API (read-only: .list()/.download(), never
// .remove()/.update()), uploads a copy of every object to the private R2
// bucket under storage/<bucket>/<path>, and writes a manifest recording
// bucket, path, size, content-type, and a sha256 checksum for each
// object so a later restore can verify integrity per-file.
//
// Never logs object paths/filenames to the console (they can embed
// patient-chosen filenames) - only aggregate counts/sizes per bucket.
// The manifest itself (which does contain paths) is uploaded privately
// to R2, never printed.
import crypto from "node:crypto";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import { r2Put, r2Head } from "./lib/r2.mjs";
import { encryptionAvailable, encryptBuffer } from "./lib/crypto.mjs";

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const ENCRYPT = encryptionAvailable();

async function walk(bucket, prefix = "") {
  const { data, error } = await supabaseAdmin().storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
  const objects = [];
  for (const item of data) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      objects.push(...(await walk(bucket, itemPath)));
    } else {
      objects.push({ path: itemPath, size: item.metadata?.size ?? 0, contentType: item.metadata?.mimetype ?? null, updatedAt: item.updated_at ?? null });
    }
  }
  return objects;
}

async function backupObject(bucket, obj) {
  const { data, error } = await supabaseAdmin().storage.from(bucket).download(obj.path);
  if (error) throw new Error(`download failed: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const uploadBody = ENCRYPT ? encryptBuffer(buf) : buf;

  const r2Key = `storage/${bucket}/${obj.path}${ENCRYPT ? ".enc" : ""}`;
  await r2Put(r2Key, uploadBody, {
    contentType: ENCRYPT ? "application/octet-stream" : obj.contentType || "application/octet-stream",
    metadata: {
      sha256,
      "source-bucket": bucket,
      "backed-up-at": new Date().toISOString(),
      "content-type": obj.contentType || "application/octet-stream",
      encrypted: String(ENCRYPT),
    },
  });

  // Verify: HEAD the uploaded object back and compare size (does not
  // re-download the body, cheap and sufficient to catch truncation).
  const head = await r2Head(r2Key);
  if (!head.exists) throw new Error(`upload verification failed: object not found after PUT`);
  if (head.size !== uploadBody.length) {
    throw new Error(`upload verification failed: size mismatch (source=${uploadBody.length} uploaded=${head.size})`);
  }

  return { ...obj, sha256, r2Key, verifiedSize: head.size, encrypted: ENCRYPT };
}

async function main() {
  console.log(`Client-side encryption: ${ENCRYPT ? "ENABLED (AES-256-GCM)" : "DISABLED (BACKUP_ENCRYPTION_KEY not set - relying on R2 at-rest encryption + private bucket only)"}`);
  const { data: buckets, error } = await supabaseAdmin().storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);

  const manifest = { runId: RUN_ID, startedAt: new Date().toISOString(), buckets: {} };
  let totalObjects = 0;
  let totalBytes = 0;
  let failures = 0;

  for (const bucket of buckets) {
    const objects = await walk(bucket.id);
    const results = [];
    for (const obj of objects) {
      try {
        const res = await backupObject(bucket.id, obj);
        results.push(res);
      } catch (e) {
        failures += 1;
        console.error(`[FAIL] bucket=${bucket.id} object backup failed: ${e.message}`);
      }
    }
    const bytes = results.reduce((sum, r) => sum + r.size, 0);
    totalObjects += results.length;
    totalBytes += bytes;
    manifest.buckets[bucket.id] = { public: bucket.public, objectCount: results.length, totalBytes: bytes, objects: results };
    console.log(`[OK] bucket=${bucket.id} public=${bucket.public} objects=${results.length} bytes=${bytes}`);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totalObjects = totalObjects;
  manifest.totalBytes = totalBytes;
  manifest.failures = failures;

  const manifestKey = `storage/manifest-${RUN_ID}.json`;
  await r2Put(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2)), { contentType: "application/json" });
  const manifestHead = await r2Head(manifestKey);

  console.log(`\nStorage backup run ${RUN_ID}`);
  console.log(`Total objects backed up: ${totalObjects}, total bytes: ${totalBytes}, failures: ${failures}`);
  console.log(`Manifest uploaded: ${manifestKey} (exists=${manifestHead.exists}, size=${manifestHead.size})`);

  if (failures > 0) {
    console.error("One or more objects failed to back up. Exiting non-zero.");
    process.exit(1);
  }
  if (!manifestHead.exists) {
    console.error("Manifest upload could not be verified. Exiting non-zero.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
