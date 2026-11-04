"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toAppLocale } from "@/i18n/messages";

/** `auth()` returning no session means no user row to read a locale preference
 *  from, so this always resolves against the default locale. */
async function notAuthenticatedError(): Promise<{ error: string }> {
  const t = await getTranslations({ locale: toAppLocale(null), namespace: "notifications.actions" });
  return { error: t("notAuthenticated") };
}

export async function markAllNotificationsRead() {
  const session = await auth();
  if (!session?.user) return notAuthenticatedError();

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });

  revalidatePath("/", "layout");
  return { success: true as const };
}

export async function markNotificationRead(id: string) {
  const session = await auth();
  if (!session?.user) return notAuthenticatedError();

  await prisma.notification.updateMany({
    where: { id, userId: session.user.id },
    data: { read: true },
  });

  revalidatePath("/", "layout");
  return { success: true as const };
}

export async function deleteNotification(id: string) {
  const session = await auth();
  if (!session?.user) return notAuthenticatedError();

  await prisma.notification.deleteMany({ where: { id, userId: session.user.id } });

  revalidatePath("/", "layout");
  revalidatePath("/notifications");
  return { success: true as const };
}
