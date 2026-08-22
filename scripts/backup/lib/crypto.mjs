// Optional client-side encryption layer using Node's built-in crypto
// (AES-256-GCM) - no custom cryptography. Only active when
// BACKUP_ENCRYPTION_KEY is set (a 32-byte key, base64-encoded). When
// absent, callers skip this layer and rely on R2's native at-rest
// encryption + private bucket + scoped credentials instead. See
// docs/DISASTER_RECOVERY.md for the full encryption model and what
// happens if this key is lost (answer: the backup is not recoverable -
// there is no key-recovery mechanism by design).
import crypto from "node:crypto";
import { getBackupEncryptionKey } from "./env.mjs";

export function encryptionAvailable() {
  return !!getBackupEncryptionKey();
}

/** Encrypts a Buffer. Output layout: [12-byte IV][16-byte auth tag][ciphertext]. */
export function encryptBuffer(plaintext) {
  const keyB64 = getBackupEncryptionKey();
  if (!keyB64) throw new Error("BACKUP_ENCRYPTION_KEY not set");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptBuffer(payload) {
  const keyB64 = getBackupEncryptionKey();
  if (!keyB64) throw new Error("BACKUP_ENCRYPTION_KEY not set");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes");

  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
