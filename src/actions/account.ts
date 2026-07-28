"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionContext } from "@/lib/store-context";
import { checkPasswordHistory, hashPassword, recordPasswordHistory, verifyPassword } from "@/lib/security/password";
import { logActivity } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/validations/password";

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: { passwordHash: true },
  });
  if (!user) return { error: "Not authorized" };

  const validCurrent = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!validCurrent) return { error: "Current password is incorrect." };

  if (await checkPasswordHistory(context.userId, parsed.data.newPassword)) {
    return { error: "You've used that password before. Choose a different one." };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await recordPasswordHistory(context.userId, user.passwordHash);
  await prisma.user.update({ where: { id: context.userId }, data: { passwordHash: newHash } });

  // Keep the current device signed in; revoke every other active session as
  // a defense-in-depth measure in case the account was already compromised.
  await prisma.userSession.updateMany({
    where: { userId: context.userId, tokenId: { not: context.sid }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "password_changed" },
  });

  await logActivity({
    storeId: context.storeId,
    userId: context.userId,
    action: "user.password_changed",
    entity: "User",
    entityId: context.userId,
  });

  await prisma.notification.create({
    data: {
      storeId: context.storeId,
      userId: context.userId,
      type: "PASSWORD_CHANGED",
      title: "Password changed",
      message: "Your password was changed. If this wasn't you, contact your administrator immediately.",
    },
  });

  return { success: true as const };
}

export async function terminateSession(sessionId: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  const session = await prisma.userSession.findFirst({
    where: { id: sessionId, userId: context.userId, revokedAt: null },
  });
  if (!session) return { error: "Session not found." };

  await prisma.userSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: "user_terminated" },
  });

  await logActivity({
    storeId: context.storeId,
    userId: context.userId,
    action: "user.session_terminated",
    entity: "UserSession",
    entityId: sessionId,
  });

  revalidatePath("/account");
  return { success: true as const, isCurrent: session.tokenId === context.sid };
}

export async function terminateAllOtherSessions() {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  await prisma.userSession.updateMany({
    where: { userId: context.userId, tokenId: { not: context.sid }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "user_terminated" },
  });

  await logActivity({
    storeId: context.storeId,
    userId: context.userId,
    action: "user.all_sessions_terminated",
    entity: "User",
    entityId: context.userId,
  });

  revalidatePath("/account");
  return { success: true as const };
}
