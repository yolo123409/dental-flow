// Phase 7 - Storage restore test.
//
// IMPORTANT scope note (documented, not fabricated): a fully separate
// disposable Supabase project's Storage API credentials were not
// provided (only its Postgres connection string was, for the DB restore
// test). Storage has no "restore into a raw Postgres connection" path -
// it requires the Storage REST API of a specific project. So this test
// restores into a brand-new, empty, PRIVATE bucket inside the SAME
// production project via the service-role Storage API, verifies
// integrity and non-public-exposure, then deletes the bucket and every
// object in it, leaving zero residue. This is a real, isolated
// (bucket-scoped) restore-and-verify - not a simulation - but it is not
// a second-project restore. That gap is called out explicitly in the
// final report.
//
// Restores FROM the R2 backup (not re-copied from the live source), so
// this also proves the R2 copy itself is intact and restorable.
import crypto from "node:crypto";
import { r2List, r2Get } from "./lib/r2.mjs";
import { decryptBuffer } from "./lib/crypto.mjs";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import { getSupabaseAdminClientConfig } from "./lib/env.mjs";

const TEST_BUCKET = `dr-restore-test-${Date.now()}`;

async function latestManifestKey() {
  const objs = await r2List("storage/manifest-");
  if (objs.length === 0) throw new Error("No storage manifest found in R2 - run backup-storage.mjs first");
  objs.sort((a, b) => (a.Key < b.Key ? 1 : -1));
  return objs[0].Key;
}

async function main() {
  const manifestKey = await latestManifestKey();
  const manifest = JSON.parse((await r2Get(manifestKey)).toString("utf8"));
  console.log(`Using manifest: ${manifestKey} (run ${manifest.runId}, ${manifest.totalObjects} objects)`);

  const admin = supabaseAdmin();
  const results = [];
  let failures = 0;

  console.log(`Creating disposable test bucket: ${TEST_BUCKET} (private)`);
  const { error: createErr } = await admin.storage.createBucket(TEST_BUCKET, { public: false });
  if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);

  try {
    for (const [bucketName, bucketInfo] of Object.entries(manifest.buckets)) {
      for (const obj of bucketInfo.objects) {
        try {
          const raw = await r2Get(obj.r2Key);
          const plain = obj.encrypted ? decryptBuffer(raw) : raw;
          const sha256 = crypto.createHash("sha256").update(plain).digest("hex");
          const checksumOk = sha256 === obj.sha256;

          const { error: upErr } = await admin.storage
            .from(TEST_BUCKET)
            .upload(obj.path, plain, { contentType: obj.contentType || "application/octet-stream", upsert: true });
          if (upErr) throw new Error(`upload: ${upErr.message}`);

          const { data: dl, error: dlErr } = await admin.storage.from(TEST_BUCKET).download(obj.path);
          if (dlErr) throw new Error(`re-download after restore: ${dlErr.message}`);
          const restoredBuf = Buffer.from(await dl.arrayBuffer());
          const sizeOk = restoredBuf.length === obj.size;
          const restoredSha = crypto.createHash("sha256").update(restoredBuf).digest("hex");
          const restoredChecksumOk = restoredSha === obj.sha256;

          results.push({
            bucket: bucketName,
            checksumMatchesManifest: checksumOk,
            sizeOk,
            restoredChecksumOk,
            contentType: obj.contentType,
          });
          if (!checksumOk || !sizeOk || !restoredChecksumOk) failures += 1;
        } catch (e) {
          failures += 1;
          console.error(`[FAIL] restore of an object from bucket=${bucketName} failed: ${e.message}`);
        }
      }
    }

    // Public-exposure check: bucket must be private, and the public
    // object URL must NOT serve content.
    const { data: bucketMeta, error: getBucketErr } = await admin.storage.getBucket(TEST_BUCKET);
    if (getBucketErr) throw new Error(`getBucket: ${getBucketErr.message}`);
    const isPrivate = bucketMeta.public === false;

    const sampleObj = results.length > 0 ? manifest.buckets[Object.keys(manifest.buckets).find((b) => manifest.buckets[b].objects.length > 0)].objects[0] : null;
    let publicUrlBlocked = null;
    if (sampleObj) {
      const supaCfg = getSupabaseAdminClientConfig();
      const publicUrl = `${supaCfg.url}/storage/v1/object/public/${TEST_BUCKET}/${sampleObj.path}`;
      const res = await fetch(publicUrl);
      publicUrlBlocked = res.status !== 200;
      console.log(`Public URL probe (unauthenticated): HTTP ${res.status} -> ${publicUrlBlocked ? "correctly blocked" : "!!! EXPOSED !!!"}`);
    }

    console.log(`\nRestored ${results.length} objects into ${TEST_BUCKET}, failures=${failures}`);
    console.log(`Bucket private: ${isPrivate}`);
    console.log(`All checksums verified: ${results.every((r) => r.checksumMatchesManifest && r.restoredChecksumOk)}`);
    console.log(`All sizes verified: ${results.every((r) => r.sizeOk)}`);

    const overallOk = failures === 0 && isPrivate && publicUrlBlocked !== false;
    if (!overallOk) {
      console.error("Storage restore test FAILED one or more checks.");
      process.exitCode = 1;
    } else {
      console.log("Storage restore test PASSED.");
    }
  } finally {
    // Cleanup: remove every object then the bucket itself, regardless of
    // pass/fail, so no residue is left behind in production.
    console.log(`\nCleaning up disposable bucket ${TEST_BUCKET}...`);
    const allPaths = [];
    for (const bucketInfo of Object.values(manifest.buckets)) {
      for (const obj of bucketInfo.objects) allPaths.push(obj.path);
    }
    if (allPaths.length > 0) {
      const { error: rmErr } = await admin.storage.from(TEST_BUCKET).remove(allPaths);
      if (rmErr) console.error(`Cleanup warning: failed to remove some objects: ${rmErr.message}`);
    }
    const { error: delBucketErr } = await admin.storage.deleteBucket(TEST_BUCKET);
    if (delBucketErr) console.error(`Cleanup warning: failed to delete bucket: ${delBucketErr.message}`);
    else console.log(`Deleted bucket ${TEST_BUCKET}. Zero residue left in production.`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
