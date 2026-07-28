"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 4000;

export async function createAnnouncement(input: { title: string; body: string }) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "announcement.manage")) {
    return { error: "Not authorized" };
  }

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > TITLE_MAX_LENGTH) return { error: "Enter a valid title." };
  if (!body || body.length > BODY_MAX_LENGTH) return { error: "Enter a valid message." };

  let scope: "PLATFORM" | "STORE";
  let storeId: string | null;
  let recipientWhere: Prisma.UserWhereInput;

  if (context.role === "SUPER_ADMIN") {
    scope = "PLATFORM";
    storeId = null;
    recipientWhere = { status: "ACTIVE", id: { not: context.userId } };
  } else {
    // MANAGER — the only other role announcement.manage is granted to.
    scope = "STORE";
    storeId = context.storeId;
    recipientWhere = { status: "ACTIVE", storeId: context.storeId, id: { not: context.userId } };
  }

  const recipients = await prisma.user.findMany({ where: recipientWhere, select: { id: true } });

  const announcement = await prisma.announcement.create({
    data: {
      scope,
      storeId,
      title,
      body,
      createdById: context.userId,
      recipients: { createMany: { data: recipients.map((r) => ({ userId: r.id })) } },
    },
  });

  if (recipients.length > 0) {
    await prisma.notification.createMany({
      data: recipients.map((r) => ({
        storeId,
        userId: r.id,
        type: "NEW_ANNOUNCEMENT" as const,
        title: "New announcement",
        message: title,
      })),
    });
  }

  await logActivity({
    storeId,
    userId: context.userId,
    action: "announcement.created",
    entity: "Announcement",
    entityId: announcement.id,
    metadata: { title, scope, recipientCount: recipients.length },
  });

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  return { success: true as const, id: announcement.id };
}

export async function markAnnouncementRead(announcementId: string) {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  await prisma.announcementRecipient.updateMany({
    where: { announcementId, userId: context.userId, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  return { success: true as const };
}

export async function markAllAnnouncementsRead() {
  const context = await getSessionContext();
  if (!context) return { error: "Not authorized" };

  await prisma.announcementRecipient.updateMany({
    where: { userId: context.userId, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  return { success: true as const };
}
