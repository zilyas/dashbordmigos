import { describe, it, expect } from "vitest";
import { hashApiKey, mintApiKey, parseKeyPrefix, verifyApiKey, bearerFrom } from "./keys";

describe("api keys", () => {
  it("mints a key that parses and verifies against its own hash", () => {
    const { key, keyPrefix, keyHash } = mintApiKey();
    expect(key.startsWith("sk_")).toBe(true);
    expect(parseKeyPrefix(key)).toBe(keyPrefix);
    expect(verifyApiKey(key, keyHash)).toBe(true);
  });

  it("never mints the same key twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintApiKey().key));
    expect(seen.size).toBe(50);
  });

  it("rejects a key whose secret half was tampered with", () => {
    const { key, keyHash } = mintApiKey();
    const tampered = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    expect(verifyApiKey(tampered, keyHash)).toBe(false);
  });

  it("rejects one key against another key's hash", () => {
    const a = mintApiKey();
    const b = mintApiKey();
    expect(verifyApiKey(a.key, b.keyHash)).toBe(false);
  });

  it("returns null for malformed keys so the caller can 401 without a DB hit", () => {
    const secret = "x".repeat(43);
    for (const bad of [
      "",
      "sk_",
      "nope",
      "Bearer sk_abc_def",
      `pk_aabbccddeeff_${secret}`, // wrong scheme
      `sk_aabbccddee_${secret}`, // prefix too short
      `sk_aabbccddeeffaa_${secret}`, // prefix too long
      `sk_aabbccddeegg_${secret}`, // prefix not hex
      "sk_aabbccddeeff_short",
      `sk_aabbccddeeff_${secret}!bad`, // "!" is outside the base64url alphabet
    ]) {
      expect(parseKeyPrefix(bad), bad).toBeNull();
    }
  });

  it("hashes deterministically and case-sensitively", () => {
    expect(hashApiKey("sk_a_b")).toBe(hashApiKey("sk_a_b"));
    expect(hashApiKey("sk_a_b")).not.toBe(hashApiKey("sk_a_B"));
    expect(hashApiKey("sk_a_b")).toHaveLength(64);
  });

  it("verifies safely when the stored hash is empty or the wrong length", () => {
    const { key } = mintApiKey();
    expect(verifyApiKey(key, "")).toBe(false);
    expect(verifyApiKey(key, "deadbeef")).toBe(false);
  });

  it("extracts bearer tokens and ignores anything else", () => {
    expect(bearerFrom("Bearer sk_abc_def")).toBe("sk_abc_def");
    expect(bearerFrom("  Bearer sk_abc_def  ")).toBe("sk_abc_def");
    expect(bearerFrom(null)).toBeNull();
    expect(bearerFrom("sk_abc_def")).toBeNull();
    expect(bearerFrom("Basic sk_abc_def")).toBeNull();
    expect(bearerFrom("bearer sk_abc_def")).toBeNull();
  });
});
