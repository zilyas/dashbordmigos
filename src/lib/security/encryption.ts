import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM: authenticated encryption, so a tampered ciphertext fails
// decrypt() instead of silently returning corrupted plaintext.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size
const AUTH_TAG_LENGTH = 16;

// Marks a value as ours so callers (and the one-off TOTP migration script)
// can tell an already-encrypted value apart from legacy plaintext without
// guessing from entropy.
const PREFIX = "enc:v1:";

/**
 * Reads and validates ENCRYPTION_KEY the same way AUTH_SECRET is documented
 * in .env.example: a 32-byte secret, base64-encoded. Checked lazily (at
 * call time, not import time) so unrelated code paths don't crash on
 * startup, but anything that actually needs to encrypt/decrypt fails loudly
 * instead of silently falling back to plaintext.
 */
export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Regenerate with randomBytes(32).toString("base64").`);
  }
  return key;
}

/** AES-256-GCM encrypt. IV and auth tag travel with the ciphertext so decrypt() is self-contained. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Reverses encrypt(). Throws if the value isn't our format, the key is wrong, or the data was tampered with. */
export function decrypt(ciphertext: string, key: Buffer): string {
  if (!ciphertext.startsWith(PREFIX)) {
    throw new Error("Not an encrypted value (missing enc:v1: prefix).");
  }
  const raw = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** True if `value` was produced by encrypt() above — lets callers skip re-encrypting or attempting to decrypt legacy plaintext. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
