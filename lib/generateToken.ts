/**
 * Cryptographically random hex token (256 bits / 64 hex chars), generated
 * client-side via the Web Crypto API - available natively in both the
 * browser and the Node/Edge runtimes Next.js uses, no dependency needed.
 * Used for invitation tokens instead of Postgres's gen_random_bytes()
 * (pgcrypto), which isn't reliably reachable from a SECURITY DEFINER
 * function's fixed search_path across Supabase projects.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
