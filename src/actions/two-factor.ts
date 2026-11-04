"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSessionContext } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  getTotpQrCodeDataUrl,
  verifyTotpCode,
} from "@/lib/security/two-factor";
import { encryptTOTPSecret, decryptTOTPSecret } from "@/lib/security/totp-encryption";
import { toAppLocale } from "@/i18n/messages";

export async function startTwoFactorEnrollment() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "account.twoFactor.actions" });
  if (!context) return { error: t("notAuthorized") };

  const existing = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (existing?.enabled) return { error: t("alreadyEnabled") };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { email: true } });
  if (!user) return { error: t("notAuthorized") };

  const secret = generateTotpSecret();
  const encryptedSecret = await encryptTOTPSecret(secret);
  await prisma.twoFactorCredential.upsert({
    where: { userId: context.userId },
    update: { secret: encryptedSecret, enabled: false, verifiedAt: null },
    create: { userId: context.userId, secret: encryptedSecret, enabled: false },
  });

  const qrCodeDataUrl = await getTotpQrCodeDataUrl(secret, user.email);
  return { success: true as const, secret, qrCodeDataUrl };
}

export async function cancelTwoFactorEnrollment() {
  const context = await getSessionContext();
  if (!context) {
    const t = await getTranslations({ locale: toAppLocale(null), namespace: "account.twoFactor.actions" });
    return { error: t("notAuthorized") };
  }
  await prisma.twoFactorCredential.deleteMany({ where: { userId: context.userId, enabled: false } });
  revalidatePath("/account");
  return { success: true as const };
}

export async function confirmTwoFactorEnrollment(code: string) {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "account.twoFactor.actions" });
  if (!context) return { error: t("notAuthorized") };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential) return { error: t("startEnrollmentFirst") };
  if (credential.enabled) return { error: t("alreadyEnabled") };

  const decryptedSecret = await decryptTOTPSecret(credential.secret);
  const valid = await verifyTotpCode(decryptedSecret, code.trim());
  if (!valid) return { error: t("invalidCode") };

  const rawCodes = generateRecoveryCodes();
  const hashedCodes = await Promise.all(rawCodes.map((c) => hashPassword(c)));

  await prisma.$transaction([
    prisma.twoFactorCredential.update({
      where: { id: credential.id },
      data: { enabled: true, verifiedAt: new Date() },
    }),
    prisma.recoveryCode.deleteMany({ where: { twoFactorId: credential.id } }),
    prisma.recoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({ twoFactorId: credential.id, codeHash })),
    }),
  ]);

  await logActivity({
    storeId: context.storeId,
    userId: context.userId,
    action: "user.two_factor_enabled",
    entity: "User",
    entityId: context.userId,
  });

  revalidatePath("/account");
  return { success: true as const, recoveryCodes: rawCodes };
}

export async function disableTwoFactor(password: string) {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "account.twoFactor.actions" });
  if (!context) return { error: t("notAuthorized") };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { passwordHash: true } });
  if (!user) return { error: t("notAuthorized") };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential?.enabled) return { error: t("notEnabled") };

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) return { error: t("incorrectPassword") };

  await prisma.twoFactorCredential.delete({ where: { userId: context.userId } });

  await logActivity({
    storeId: context.storeId,
    userId: context.userId,
    action: "user.two_factor_disabled",
    entity: "User",
    entityId: context.userId,
  });

  revalidatePath("/account");
  return { success: true as const };
}

export async function regenerateRecoveryCodes(password: string) {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "account.twoFactor.actions" });
  if (!context) return { error: t("notAuthorized") };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { passwordHash: true } });
  if (!user) return { error: t("notAuthorized") };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential?.enabled) return { error: t("notEnabled") };

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) return { error: t("incorrectPassword") };

  const rawCodes = generateRecoveryCodes();
  const hashedCodes = await Promise.all(rawCodes.map((c) => hashPassword(c)));

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { twoFactorId: credential.id } }),
    prisma.recoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({ twoFactorId: credential.id, codeHash })),
    }),
  ]);

  return { success: true as const, recoveryCodes: rawCodes };
}
