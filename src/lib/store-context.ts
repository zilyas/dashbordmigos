import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

export type SessionContext = {
  userId: string;
  role: Role;
  storeId: string | null;
  sid: string;
};

/**
 * Reads the current session once and returns the scoping context every
 * store-owned query/action is keyed on. For MANAGER/SELLER, `storeId` is
 * never sourced from anywhere else (never a form field, never a query
 * param) — this is what makes cross-tenant access impossible even if a
 * request is hand-crafted.
 *
 * Also confirms the session's backing UserSession row is still live.
 * Middleware (edge runtime) only checks the JWT itself, so a just-revoked
 * session — "log out everywhere", "terminate session" — can still pass the
 * edge role-check for at most one more request; this is the check that
 * actually rejects it, on the first real page/action it hits.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth();
  if (!session?.user || !session.sid) return null;

  const userSession = await prisma.userSession.findUnique({
    where: { tokenId: session.sid },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!userSession || userSession.revokedAt || userSession.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    storeId: session.user.storeId,
    sid: session.sid,
  };
}

/**
 * For MANAGER/SELLER, throws if storeId is somehow missing (defensive —
 * should never happen for these roles). Returns the non-null storeId.
 */
export function requireStoreId(context: SessionContext): string {
  if (!context.storeId) {
    throw new Error("Session is missing a required storeId");
  }
  return context.storeId;
}
