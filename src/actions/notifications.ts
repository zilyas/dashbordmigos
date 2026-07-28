"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function markAllNotificationsRead() {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });

  revalidatePath("/", "layout");
  return { success: true as const };
}

export async function markNotificationRead(id: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  await prisma.notification.updateMany({
    where: { id, userId: session.user.id },
    data: { read: true },
  });

  revalidatePath("/", "layout");
  return { success: true as const };
}

export async function deleteNotification(id: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  await prisma.notification.deleteMany({ where: { id, userId: session.user.id } });

  revalidatePath("/", "layout");
  revalidatePath("/notifications");
  return { success: true as const };
}
