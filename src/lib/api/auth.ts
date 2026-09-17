/**
 * Authentication and error contract for the public `/api/v1/**` surface.
 *
 * `src/proxy.ts`'s matcher excludes `api`, so NOTHING runs before a route
 * handler — no session check, no role gate, not even the `x-request-id` stamp.
 * Every v1 handler therefore starts with `authenticateApiRequest()`.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFrom, parseKeyPrefix, verifyApiKey } from "@/lib/api/keys";
import { rateLimit } from "@/lib/security/rate-limit";
import { scopedLogger } from "@/lib/logger";

const apiLogger = scopedLogger("system");

/**
 * Scope vocabulary, deliberately disjoint from `Permission` in
 * `src/lib/rbac.ts`. A storefront key must not be able to express
 * `sale.delete` / `product.delete` even by accident.
 */
export const API_SCOPES = ["products:read", "stock:read", "orders:create"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type ApiClientContext = {
  clientId: string;
  storeId: string;
  /** The real user every Sale / InventoryMovement / ActivityLog is attributed to. */
  actorUserId: string;
  scopes: string[];
};

export const API_RATE_LIMITS = {
  read: { limit: 120, windowMs: 60 * 1000 },
  orders: { limit: 30, windowMs: 60 * 1000 },
} as const;

/** Stable machine-readable error body. Prose lives in `message`, codes never change. */
export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

type AuthFailure = { ok: false; response: NextResponse };
type AuthSuccess = { ok: true; context: ApiClientContext };

/**
 * Resolves a presented bearer key to a live, non-revoked, non-expired client
 * whose store is still ACTIVE, then records one hit against its rate bucket.
 *
 * Every check hits the database on every request — there is no cache. That is
 * deliberate: a cached decision is exactly how a revoked credential keeps
 * working, which is the failure mode `getStorelessSessionContext()` exists to
 * prevent for human sessions.
 */
export async function authenticateApiRequest(
  request: Request,
  scope: ApiScope,
  bucket: keyof typeof API_RATE_LIMITS = "read"
): Promise<AuthSuccess | AuthFailure> {
  const key = bearerFrom(request.headers.get("authorization"));
  if (!key) {
    return { ok: false, response: apiError(401, "unauthorized", "Missing Authorization: Bearer <api key>.") };
  }

  const prefix = parseKeyPrefix(key);
  if (!prefix) {
    return { ok: false, response: apiError(401, "unauthorized", "Malformed API key.") };
  }

  const client = await prisma.apiClient.findUnique({
    where: { keyPrefix: prefix },
    select: {
      id: true,
      storeId: true,
      actorUserId: true,
      scopes: true,
      status: true,
      keyHash: true,
      expiresAt: true,
      revokedAt: true,
      store: { select: { status: true } },
      actor: { select: { status: true } },
    },
  });

  // Same response for "no such prefix" and "wrong secret" so the API cannot be
  // used to confirm which prefixes exist.
  if (!client || !verifyApiKey(key, client.keyHash)) {
    apiLogger.warn({ prefix }, "api auth failed: unknown or invalid key");
    return { ok: false, response: apiError(401, "unauthorized", "Invalid API key.") };
  }

  const now = Date.now();
  const dead =
    client.status !== "ACTIVE" ||
    client.revokedAt !== null ||
    (client.expiresAt !== null && client.expiresAt.getTime() <= now) ||
    client.store.status !== "ACTIVE" ||
    client.actor.status !== "ACTIVE";

  if (dead) {
    apiLogger.warn({ clientId: client.id, storeId: client.storeId }, "api auth failed: credential or store inactive");
    return { ok: false, response: apiError(403, "credential_inactive", "This API key is revoked, expired, or its store is inactive.") };
  }

  if (!client.scopes.includes(scope)) {
    return { ok: false, response: apiError(403, "insufficient_scope", `This API key lacks the "${scope}" scope.`, { requiredScope: scope }) };
  }

  // Per-credential, NOT per-IP: the caller is a server, so its IP is stable and
  // its key is the only identity that matters. Keyed by bucket so a burst of
  // catalog reads cannot consume the order budget.
  const limit = API_RATE_LIMITS[bucket];
  const verdict = await rateLimit(`api:${bucket}:${client.id}`, limit);
  if (!verdict.success) {
    const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - now) / 1000));
    const res = apiError(429, "rate_limited", "Too many requests. Slow down and retry.");
    res.headers.set("Retry-After", String(retryAfter));
    return { ok: false, response: res };
  }

  // Fire-and-forget: a lastUsedAt write must never fail a real request.
  void prisma.apiClient
    .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    context: {
      clientId: client.id,
      storeId: client.storeId,
      actorUserId: client.actorUserId,
      scopes: client.scopes,
    },
  };
}

/** Stock levels must never be cached anywhere between us and the storefront. */
export function noStore<T extends NextResponse>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
