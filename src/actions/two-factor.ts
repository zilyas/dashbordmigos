"use server";

import { revalidatePath } from "next/cache";
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

export async function startTwoFactorEnrollment() {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const existing = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (existing?.enabled) return { error: "Two-factor authentication is already enabled." };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { email: true } });
  if (!user) return { error: "Not authorized" };

  const secret = generateTotpSecret();
  await prisma.twoFactorCredential.upsert({
    where: { userId: context.userId },
    update: { secret, enabled: false, verifiedAt: null },
    create: { userId: context.userId, secret, enabled: false },
  });

  const qrCodeDataUrl = await getTotpQrCodeDataUrl(secret, user.email);
  return { success: true as const, secret, qrCodeDataUrl };
}

export async function cancelTwoFactorEnrollment() {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };
  await prisma.twoFactorCredential.deleteMany({ where: { userId: context.userId, enabled: false } });
  revalidatePath("/account");
  return { success: true as const };
}

export async function confirmTwoFactorEnrollment(code: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential) return { error: "Start enrollment first." };
  if (credential.enabled) return { error: "Two-factor authentication is already enabled." };

  const valid = await verifyTotpCode(credential.secret, code.trim());
  if (!valid) return { error: "Invalid code. Check your authenticator app and try again." };

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
  if (!context) return { error: "Not authorized" };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { passwordHash: true } });
  if (!user) return { error: "Not authorized" };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential?.enabled) return { error: "Two-factor authentication is not enabled." };

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) return { error: "Incorrect password." };

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
  if (!context) return { error: "Not authorized" };

  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { passwordHash: true } });
  if (!user) return { error: "Not authorized" };

  const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: context.userId } });
  if (!credential?.enabled) return { error: "Two-factor authentication is not enabled." };

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) return { error: "Incorrect password." };

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
