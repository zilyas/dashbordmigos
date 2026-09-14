import { randomBytes } from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { decrypt, encrypt, getEncryptionKey, isEncrypted } from "@/lib/security/encryption";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", () => {
    const ciphertext = encrypt("hello world", KEY);
    expect(ciphertext).not.toBe("hello world");
    expect(decrypt(ciphertext, KEY)).toBe("hello world");
  });

  it("round-trips empty and unicode content", () => {
    for (const value of ["", "🔐 TOTP secret ünïcödé", "{}"]) {
      expect(decrypt(encrypt(value, KEY), KEY)).toBe(value);
    }
  });

  it("produces a value the wrong key cannot decrypt", () => {
    const ciphertext = encrypt("hello world", KEY);
    expect(() => decrypt(ciphertext, OTHER_KEY)).toThrow();
  });

  it("fails auth tag check on a tampered ciphertext", () => {
    const ciphertext = encrypt("hello world", KEY);
    // Flip the last base64 character — corrupts the trailing ciphertext byte.
    const tampered = ciphertext.slice(0, -1) + (ciphertext.at(-1) === "A" ? "B" : "A");
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects a value without the enc:v1: prefix", () => {
    expect(() => decrypt("plain-base32-secret", KEY)).toThrow(/enc:v1:/);
  });

  it("is idempotently detectable via isEncrypted", () => {
    expect(isEncrypted("JBSWY3DPEHPK3PXP")).toBe(false); // typical base32 TOTP secret
    expect(isEncrypted(encrypt("x", KEY))).toBe(true);
  });
});

describe("getEncryptionKey", () => {
  const ORIGINAL = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = ORIGINAL;
  });

  it("throws when unset", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => getEncryptionKey()).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("throws when not 32 bytes", () => {
    process.env.ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => getEncryptionKey()).toThrow(/32 bytes/);
  });

  it("returns a 32-byte buffer for a valid key", () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(getEncryptionKey()).toHaveLength(32);
  });
});
