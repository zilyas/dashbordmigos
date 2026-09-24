import { decryptTOTPSecret } from "@/lib/security/totp-encryption";
import { verifyTotpCode } from "@/lib/security/two-factor";

/**
 * Verifies a user-entered TOTP code against a credential's stored secret.
 * The secret is encrypted at rest and must be decrypted before verification.
 * Decryption failures (bad/rotated ENCRYPTION_KEY, corrupt ciphertext) are
 * treated as an invalid code so callers fail closed instead of throwing.
 */
export async function verifyStoredTotpCode(encryptedSecret: string, code: string): Promise<boolean> {
  let secret: string;
  try {
    secret = await decryptTOTPSecret(encryptedSecret);
  } catch {
    return false;
  }
  return verifyTotpCode(secret, code);
}
