import { describe, it, expect, vi } from "vitest";
import { verifyStoredTotpCode } from "@/lib/security/verify-stored-totp";
import { decryptTOTPSecret } from "@/lib/security/totp-encryption";
import { verifyTotpCode } from "@/lib/security/two-factor";

vi.mock("@/lib/security/totp-encryption", () => ({
  decryptTOTPSecret: vi.fn(),
}));
vi.mock("@/lib/security/two-factor", () => ({
  verifyTotpCode: vi.fn(),
}));

describe("verifyStoredTotpCode", () => {
  it("verifies against the decrypted secret, not the stored ciphertext", async () => {
    vi.mocked(decryptTOTPSecret).mockResolvedValue("PLAINSECRET");
    vi.mocked(verifyTotpCode).mockResolvedValue(true);

    const result = await verifyStoredTotpCode("enc:v1:ciphertext", "123456");

    expect(result).toBe(true);
    expect(verifyTotpCode).toHaveBeenCalledWith("PLAINSECRET", "123456");
    expect(verifyTotpCode).not.toHaveBeenCalledWith("enc:v1:ciphertext", "123456");
  });

  it("fails closed when decryption throws, without leaking the error", async () => {
    vi.mocked(decryptTOTPSecret).mockRejectedValue(new Error("bad ENCRYPTION_KEY"));

    const result = await verifyStoredTotpCode("enc:v1:corrupt", "123456");

    expect(result).toBe(false);
    expect(verifyTotpCode).not.toHaveBeenCalled();
  });
});
