import { randomBytes } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

const ISSUER = "Store OS";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function getTotpProvisioningUri(secret: string, email: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

export async function getTotpQrCodeDataUrl(secret: string, email: string): Promise<string> {
  return QRCode.toDataURL(getTotpProvisioningUri(secret, email));
}

/** ±1 time-step (30s) tolerance for clock drift between the server and the authenticator app. */
export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(6).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}
