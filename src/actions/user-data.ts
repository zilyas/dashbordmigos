"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getStorelessSessionContext } from "@/lib/store-context";
import { requirePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";

const DELETION_CONFIRMATION_TEXT = "DELETE";
// Tombstone marker for an anonymized account — also doubles as the "already
// deleted" check so a repeat request doesn't re-anonymize or double-log.
const DELETED_EMAIL_SUFFIX = "@deleted.invalid";

/**
 * SUPER_ADMIN-only guard reused from the manager lifecycle actions
 * (src/actions/managers.ts) — "manager.manage" is already the platform-wide
 * account-management permission, so a cross-user data-subject-rights action
 * doesn't need a new Permission added to rbac.ts.
 */
const requirePlatformAdmin = requirePermission("manager.manage");

// GDPR Art. 15/20 — access + portability. Self-service always; SUPER_ADMIN
// may export any other user. Never includes auth material (password hash,
// TOTP secret, recovery codes, password history) — those are excluded by
// simply never being selected/queried below.
export async function exportUserData(targetUserId?: string) {
  const session = await getStorelessSessionContext();
  if (!session) return { error: "Not authorized" };

  // The target is resolved from the verified session, not trusted from the
  // caller, unless the caller is SUPER_ADMIN — this is what keeps a
  // non-admin from exporting anyone but themselves even with a hand-crafted
  // request.
  let userId = session.userId;
  if (targetUserId && targetUserId !== session.userId) {
    if (session.role !== "SUPER_ADMIN") return { error: "Not authorized" };
    userId = targetUserId;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      storeId: true,
      phone: true,
      avatar: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      lastLogin: true,
      store: { select: { id: true, name: true, code: true } },
      // passwordHash intentionally NOT selected — auth material, not a
      // portability concern.
    },
  });
  if (!user) return { error: "User not found" };

  const [sales, activityLogs, notifications, userSessions, twoFactor] = await Promise.all([
    prisma.sale.findMany({ where: { sellerId: userId } }),
    prisma.activityLog.findMany({ where: { userId } }),
    prisma.notification.findMany({ where: { userId } }),
    prisma.userSession.findMany({
      where: { userId },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        browser: true,
        os: true,
        rememberMe: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
        // tokenId (the raw session token value) intentionally NOT selected.
      },
    }),
    prisma.twoFactorCredential.findUnique({
      where: { userId },
      select: { enabled: true },
      // secret and recoveryCodes intentionally NOT selected/queried.
    }),
  ]);

  await logActivity({
    storeId: session.storeId,
    userId: session.userId,
    action: "user.data_exported",
    entity: "User",
    entityId: userId,
    metadata: { self: userId === session.userId },
  });

  return {
    success: true as const,
    exportedAt: new Date().toISOString(),
    data: {
      user,
      sales,
      activityLogs,
      notifications,
      userSessions,
      twoFactorEnabled: twoFactor?.enabled ?? false,
    },
  };
}

// GDPR Art. 17 — right to be forgotten. SUPER_ADMIN only, explicit typed
// confirmation (same pattern as backup.ts's RESTORE_CONFIRMATION_TEXT).
//
// This is a SOFT delete, not a hard delete: Sale.seller, ActivityLog.user,
// Product.createdBy etc. are `onDelete: Restrict`/default-restrict FKs (see
// prisma/schema.prisma), so a hard delete of a user with any sales or audit
// history would throw a foreign-key violation. Anonymizing in place instead
// preserves that history's integrity while removing the person's PII.
//
// There is no `deletedAt` (or any "deleted" status) field on User — the
// schema's UserStatus enum only has ACTIVE/INACTIVE. Per instructions this
// action does not add one; it reuses the existing `status` field (the same
// convention already used by toggleSellerStatus/deleteSeller's FK-fallback
// in src/actions/users.ts) plus tombstoning name/email/phone/avatar. The
// "when" of deletion is recorded by the `user.deletion_requested`
// ActivityLog row's own createdAt — there's no per-user deletedAt timestamp
// to query later, only the audit trail.
export async function requestUserDeletion(targetUserId: string, confirmText: string) {
  const session = await requirePlatformAdmin();

  if (confirmText !== DELETION_CONFIRMATION_TEXT) {
    return { error: `Type "${DELETION_CONFIRMATION_TEXT}" to confirm.` };
  }

  if (targetUserId === session.user.id) {
    return { error: "You cannot delete your own account this way." };
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { error: "User not found" };

  if (target.email.endsWith(DELETED_EMAIL_SUFFIX)) {
    return { error: "This account has already been deleted." };
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: {
      name: "Deleted User",
      email: `deleted-${targetUserId}${DELETED_EMAIL_SUFFIX}`,
      phone: null,
      avatar: null,
      status: "INACTIVE",
    },
  });

  await logActivity({
    storeId: session.user.storeId,
    userId: session.user.id,
    action: "user.deletion_requested",
    entity: "User",
    entityId: targetUserId,
    metadata: { role: target.role },
  });

  revalidatePath("/users");
  revalidatePath("/managers");
  return { success: true as const };
}
