import { decrypt, encrypt, getEncryptionKey, isEncrypted } from "@/lib/security/encryption";

export async function encryptTOTPSecret(secret: string): Promise<string> {
  const key = getEncryptionKey();
  return encrypt(secret, key);
}

export async function decryptTOTPSecret(encrypted: string): Promise<string> {
  const key = getEncryptionKey();
  if (isEncrypted(encrypted)) {
    return decrypt(encrypted, key);
  }
  return encrypted;
}
