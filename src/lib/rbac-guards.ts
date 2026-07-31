import { auth } from "@/lib/auth";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { can, type Permission } from "@/lib/rbac";

/**
 * Server Action guard factories. Kept out of `@/lib/rbac` — that module is
 * imported by Client Components (`can()`/`ROLE_PERMISSIONS` for UI gating),
 * and pulling in `auth`/`getSessionContext` here drags Prisma's Node-only
 * driver into the client bundle.
 */

/** Requires `permission`, returns the raw Auth.js session. */
export function requirePermission(permission: Permission) {
  return async function requireSession() {
    const session = await auth();
    if (!session?.user || !can(session.user.role, permission)) {
      throw new Error("Not authorized");
    }
    return session;
  };
}

/** Requires `permission`, returns the store-scoped session context. */
export function requireStorePermission(permission: Permission) {
  return async function requireContext() {
    const context = await getSessionContext();
    if (!context || !can(context.role, permission)) {
      throw new Error("Not authorized");
    }
    return { ...context, storeId: requireStoreId(context) };
  };
}
