// Thin wrapper around the S3-compatible client for Cloudflare R2.
// Never logs credentials. Object bodies (which may contain patient data
// once compressed/encrypted) are never logged either - only keys/sizes.
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getR2Config } from "./env.mjs";

let client = null;
export function r2Client() {
  if (client) return client;
  const cfg = getR2Config();
  client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return client;
}

export async function r2Put(key, body, { contentType = "application/octet-stream", metadata = {} } = {}) {
  const cfg = getR2Config();
  await r2Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    })
  );
}

export async function r2Head(key) {
  const cfg = getR2Config();
  try {
    const res = await r2Client().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return { exists: true, size: res.ContentLength, metadata: res.Metadata, etag: res.ETag };
  } catch (e) {
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return { exists: false };
    throw e;
  }
}

export async function r2Get(key) {
  const cfg = getR2Config();
  const res = await r2Client().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function r2List(prefix) {
  const cfg = getR2Config();
  const out = [];
  let ContinuationToken;
  do {
    const res = await r2Client().send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken })
    );
    for (const obj of res.Contents ?? []) out.push(obj);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

export async function r2Delete(key) {
  const cfg = getR2Config();
  await r2Client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}
