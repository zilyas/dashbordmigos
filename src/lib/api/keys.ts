/**
 * Minting and verifying machine API keys. Pure crypto + string handling; no
 * Prisma, so it stays unit-testable (`keys.test.ts`).
 *
 * Key shape: `sk_<prefix>_<secret>` — the prefix half is stored in the clear
 * and indexed (`ApiClient.keyPrefix`), the secret half is never stored at all.
 * Only SHA-256 of the WHOLE key goes to `ApiClient.keyHash`.
 *
 * SHA-256 rather than Argon2 (which `src/lib/security/password.ts` correctly
 * uses for passwords): the secret is 256 bits of CSPRNG output, so there is no
 * dictionary to stretch against, and Argon2's ~19 MiB per verification would be
 * paid on every single API request.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX_BYTES = 6;
const SECRET_BYTES = 32;

/** `sk_<12 hex>_<base64url secret>`. base64url is [A-Za-z0-9_-]. */
const KEY_PATTERN = new RegExp(`^sk_([0-9a-f]{${PREFIX_BYTES * 2}})_([A-Za-z0-9_-]{32,})$`);

export type MintedKey = {
  /** Shown to the operator exactly once. Never persisted. */
  key: string;
  keyPrefix: string;
  keyHash: string;
};

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function mintApiKey(): MintedKey {
  const keyPrefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `sk_${keyPrefix}_${secret}`;
  return { key, keyPrefix, keyHash: hashApiKey(key) };
}

/**
 * Pulls the indexed lookup handle out of a presented key. Returns null for any
 * malformed input so a caller can 401 without ever touching the database.
 */
export function parseKeyPrefix(key: string): string | null {
  // Matched whole, not split on "_": the base64url secret contains "_" itself,
  // so splitting would reject most legitimate keys.
  const match = KEY_PATTERN.exec(key);
  return match ? match[1] : null;
}

/** Constant-time hash comparison. Both sides are fixed-length hex, so a plain
 * length check first cannot leak anything a prefix lookup did not already. */
export function verifyApiKey(key: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(key), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Extracts the raw key from an `Authorization: Bearer <key>` header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}
