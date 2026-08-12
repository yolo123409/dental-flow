import { validatePassword } from "@/lib/passwordPolicy";

/**
 * Cryptographically random temporary password, same primitive as
 * lib/generateToken.ts (crypto.getRandomValues - never Math.random,
 * timestamps, or anything derived from the user's name/email/org). Used
 * server-side only (app/api/organization-invitations routes) to seed a
 * brand-new invitee's auth account; never persisted, only ever returned
 * once in the API response.
 *
 * Guarantees the result satisfies lib/passwordPolicy.ts by construction
 * (at least one uppercase, one lowercase, one digit), then fills to 12
 * characters and shuffles with a crypto-random Fisher-Yates so the
 * guaranteed characters aren't predictably positioned.
 */
export function generatePassword(): string {
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O - avoid look-alikes
  const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l
  const DIGITS = "23456789"; // no 0/1
  const ALL = UPPER + LOWER + DIGITS;

  const LENGTH = 12;

  function randomChar(charset: string): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return charset[bytes[0] % charset.length];
  }

  const chars = [
    randomChar(UPPER),
    randomChar(LOWER),
    randomChar(DIGITS),
  ];

  while (chars.length < LENGTH) {
    chars.push(randomChar(ALL));
  }

  // Fisher-Yates shuffle, crypto-random throughout.
  for (let i = chars.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const password = chars.join("");

  // Belt-and-suspenders - the construction above already guarantees this.
  if (!validatePassword(password).valid) {
    throw new Error("Generated password failed policy validation.");
  }

  return password;
}
