import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptTOTPSecret, decryptTOTPSecret } from "@/lib/security/totp-encryption";
import { randomBytes } from "crypto";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("encryptTOTPSecret / decryptTOTPSecret", () => {
  it("round-trips a TOTP secret", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = await encryptTOTPSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(await decryptTOTPSecret(encrypted)).toBe(secret);
  });

  it("round-trips unicode and empty secrets", async () => {
    for (const secret of ["", "🔐 secret-unicode", "{}"]) {
      const encrypted = await encryptTOTPSecret(secret);
      expect(await decryptTOTPSecret(encrypted)).toBe(secret);
    }
  });

  it("throws when ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(encryptTOTPSecret("secret")).rejects.toThrow(/ENCRYPTION_KEY/);
    await expect(decryptTOTPSecret("enc:v1:abc")).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("distinguishes encrypted from plaintext secrets", async () => {
    const plaintext = "plain-secret-123";
    const encrypted = await encryptTOTPSecret(plaintext);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(plaintext).not.toMatch(/^enc:v1:/);
  });

  it("throws on tampered ciphertext", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = await encryptTOTPSecret(secret);
    const tampered = encrypted.slice(0, -1) + (encrypted.at(-1) === "A" ? "B" : "A");
    await expect(decryptTOTPSecret(tampered)).rejects.toThrow();
  });
});
