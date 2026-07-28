import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/store-context";
import type { Role } from "@/generated/prisma/enums";

export type MessageableUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string | null;
  storeId: string | null;
};

const MESSAGEABLE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
  storeId: true,
} as const;

/**
 * Server-computed allowed-recipient list, per the platform hierarchy:
 * - Super Admin: everyone.
 * - Manager: everyone in their own store (other Managers, their Sellers)
 *   plus every Super Admin — never another store.
 * - Seller: their store's Manager(s) plus every Super Admin — never
 *   another store, never another store's Sellers.
 *
 * Every send/create-conversation action must re-validate every recipient
 * against this — a client-supplied recipient list is never trusted, same
 * principle as store isolation elsewhere in the app.
 */
export async function getMessageableUsers(context: SessionContext): Promise<MessageableUser[]> {
  if (context.role === "SUPER_ADMIN") {
    return prisma.user.findMany({
      where: { status: "ACTIVE", id: { not: context.userId } },
      select: MESSAGEABLE_USER_SELECT,
      orderBy: { name: "asc" },
    });
  }

  if (context.role === "MANAGER") {
    return prisma.user.findMany({
      where: {
        status: "ACTIVE",
        id: { not: context.userId },
        OR: [{ storeId: context.storeId }, { role: "SUPER_ADMIN" }],
      },
      select: MESSAGEABLE_USER_SELECT,
      orderBy: { name: "asc" },
    });
  }

  // SELLER
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: { not: context.userId },
      OR: [{ storeId: context.storeId, role: "MANAGER" }, { role: "SUPER_ADMIN" }],
    },
    select: MESSAGEABLE_USER_SELECT,
    orderBy: { name: "asc" },
  });
}

/** Validates a whole recipient list in one query instead of one per id. */
export async function canMessageUsers(context: SessionContext, targetUserIds: string[]): Promise<boolean> {
  if (targetUserIds.length === 0) return false;
  const messageable = await getMessageableUsers(context);
  const allowedIds = new Set(messageable.map((u) => u.id));
  return targetUserIds.every((id) => allowedIds.has(id));
}

export async function canMessageUser(context: SessionContext, targetUserId: string): Promise<boolean> {
  return canMessageUsers(context, [targetUserId]);
}
