"use server";

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { checkPasswordHistory, hashPassword, recordPasswordHistory } from "@/lib/security/password";
import { getRequestInfo } from "@/lib/security/request-info";
import { RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { logActivity } from "@/lib/audit";
import { logServerError } from "@/lib/logger";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validations/password";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const GENERIC_MESSAGE = "If an account exists for that email, a reset link has been generated.";

export async function requestPasswordReset(input: { email: string }) {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data.email.toLowerCase();

  const info = await getRequestInfo();
  const limit = await rateLimit(`password-reset:${info.ipAddress ?? "unknown"}:${email}`, RATE_LIMITS.passwordReset);
  if (!limit.success) {
    return { error: "Too many reset requests. Please wait a while and try again." };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!user || user.status !== "ACTIVE") {
    return { success: true as const, message: GENERIC_MESSAGE };
  }

  const rawToken = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // Dev-mode stub: no email provider is configured. In dev, the link is
  // returned directly; in production, the token is created but never
  // delivered, and both paths return the same generic response to prevent
  // account enumeration.
  if (process.env.NODE_ENV === "production") {
    await logServerError("app", new Error("Email delivery not configured"), {
      action: "password_reset_email_delivery_missing",
      email,
      userId: user.id,
    });
    return { success: true as const, message: GENERIC_MESSAGE };
  }

  return {
    success: true as const,
    message: GENERIC_MESSAGE,
    resetLink: `/reset-password/${rawToken}`,
  };
}

export async function resetPassword(input: { token: string; password: string; confirmPassword: string }) {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { token, password } = parsed.data;

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, passwordHash: true, status: true, storeId: true } } },
  });

  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.expiresAt.getTime() <= Date.now() ||
    resetToken.user.status !== "ACTIVE"
  ) {
    return { error: "This reset link is invalid or has expired." };
  }

  if (await checkPasswordHistory(resetToken.user.id, password)) {
    return { error: "You've used that password before. Choose a different one." };
  }

  const newHash = await hashPassword(password);
  await recordPasswordHistory(resetToken.user.id, resetToken.user.passwordHash);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.user.id },
      data: { passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    prisma.userSession.updateMany({
      where: { userId: resetToken.user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "password_reset" },
    }),
  ]);

  await logActivity({
    storeId: resetToken.user.storeId,
    userId: resetToken.user.id,
    action: "user.password_reset_self",
    entity: "User",
    entityId: resetToken.user.id,
  });

  await prisma.notification.create({
    data: {
      storeId: resetToken.user.storeId,
      userId: resetToken.user.id,
      type: "PASSWORD_CHANGED",
      title: "Password changed",
      message: "Your password was reset. If this wasn't you, contact your administrator immediately.",
    },
  });

  return { success: true as const };
}
