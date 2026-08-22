// Phase 8/13 - Controlled failure-handling tests.
//
// Verifies that our backup code correctly detects and reports failure
// conditions rather than silently succeeding: invalid credentials, an
// inaccessible/wrong destination, an object that never finished
// uploading, and a corrupted archive (checksum mismatch). Runs only
// against R2 (no production data involved) and only ever writes under
// a `test/failure-tests/` prefix, cleaned up at the end. Never logs any
// credential value, real or fake.
import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Config } from "./lib/env.mjs";
import { r2Put, r2Head, r2Get, r2Delete } from "./lib/r2.mjs";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

async function testInvalidCredentials() {
  const cfg = getR2Config();
  const badClient = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    // Correctly-shaped-but-wrong credentials (R2 requires 32-char access
    // keys), so this exercises the real auth rejection path rather than
    // a client-side format-validation error.
    credentials: { accessKeyId: "0".repeat(32), secretAccessKey: "0".repeat(64) },
  });
  try {
    await badClient.send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: "test/failure-tests/should-not-exist.txt", Body: Buffer.from("x") })
    );
    record("Invalid R2 credentials are rejected (upload should fail)", false, "upload unexpectedly SUCCEEDED with bad credentials");
  } catch (e) {
    const looksLikeAuthFailure = /InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|Forbidden|InvalidArgument|Unauthorized/i.test(e.name + " " + e.message);
    record("Invalid R2 credentials are rejected (upload should fail)", looksLikeAuthFailure, `error type: ${e.name}`);
  }
}

async function testInaccessibleDestination() {
  const cfg = getR2Config();
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  try {
    await client.send(
      new PutObjectCommand({ Bucket: "dentalflow-backups-nonexistent-bucket-xyz", Key: "test.txt", Body: Buffer.from("x") })
    );
    record("Upload to a nonexistent/inaccessible bucket fails", false, "upload unexpectedly SUCCEEDED");
  } catch (e) {
    record("Upload to a nonexistent/inaccessible bucket fails", true, `error type: ${e.name}`);
  }
}

async function testInterruptedUploadDetection() {
  // Simulates the detection path (not the network interruption itself,
  // which isn't practically simulable at this layer): a key that was
  // never successfully uploaded must report exists:false, which is
  // exactly the signal backup-database.mjs / backup-storage.mjs use to
  // fail the run rather than record a false success.
  const neverUploadedKey = `test/failure-tests/never-uploaded-${Date.now()}.bin`;
  const head = await r2Head(neverUploadedKey);
  record("A never-completed upload is correctly detected as absent", head.exists === false);
}

async function testCorruptedArchiveDetection() {
  const key = `test/failure-tests/corruption-check-${Date.now()}.bin`;
  const original = crypto.randomBytes(1024);
  const sha256 = crypto.createHash("sha256").update(original).digest("hex");
  await r2Put(key, original, { metadata: { sha256 } });

  const downloaded = await r2Get(key);
  const intact = crypto.createHash("sha256").update(downloaded).digest("hex") === sha256;
  record("Checksum verification passes for an intact archive", intact);

  // Corrupt a byte and confirm the SAME comparison logic now fails, as
  // it would for a genuinely corrupted backup.
  const corrupted = Buffer.from(downloaded);
  corrupted[0] = corrupted[0] ^ 0xff;
  const corruptedMatches = crypto.createHash("sha256").update(corrupted).digest("hex") === sha256;
  record("Checksum verification detects a corrupted archive", corruptedMatches === false);

  await r2Delete(key);
}

async function main() {
  console.log("Running controlled failure-handling tests (Phase 8/13)...\n");
  await testInvalidCredentials();
  await testInaccessibleDestination();
  await testInterruptedUploadDetection();
  await testCorruptedArchiveDetection();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} failure-handling tests passed.`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
