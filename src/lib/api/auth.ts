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
import { parseFeatures } from "@/lib/features";

const apiLogger = scopedLogger("system");

/**
 * Scope vocabulary, deliberately disjoint from `Permission` in
 * `src/lib/rbac.ts`. A storefront key must not be able to express
 * `sale.delete` / `product.delete` even by accident.
 *
 * Defined in `@/lib/api/scopes` and re-exported here: Client Components need
 * the list for the create-key form, and importing this module would pull
 * Prisma into the browser bundle.
 */
export { API_SCOPES, type ApiScope } from "@/lib/api/scopes";
import type { ApiScope } from "@/lib/api/scopes";

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

/**
 * The outer, pre-authentication gate — spent before the database is ever
 * touched, keyed on caller IP + key prefix rather than a client id, because at
 * this point we do not yet know whether the presented key belongs to anyone,
 * and finding out is exactly the query this gate exists to avoid paying for.
 * It has to be looser than the per-credential limits above: several real
 * clients can legitimately share one NAT'd or corporate-proxy IP.
 */
export const API_PRE_AUTH_RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 } as const;

/**
 * The per-IP ceiling, spent alongside the per-prefix gate above.
 *
 * The prefix gate alone does not actually bound the database: an attacker who
 * rotates the prefix on every attempt gets a fresh 20/min bucket for each
 * guess, which is precisely the unlimited stream of unauthenticated lookups
 * this whole change exists to stop. This second bucket ignores the prefix, so
 * the total cost one IP can impose is bounded no matter how many distinct keys
 * it invents. It is set well above the prefix limit so a shared corporate IP
 * running several real integrations never reaches it in normal use.
 */
export const API_PRE_AUTH_IP_RATE_LIMIT = { limit: 120, windowMs: 60 * 1000 } as const;

/**
 * The caller's IP, used only to key the pre-auth limiter below — never
 * trusted for anything security-sensitive like an allowlist. Plain `Request`
 * (unlike Next's `NextRequest`) has no `.ip`, so we read the proxy headers
 * Next.js's runtime sets: the first hop of `x-forwarded-for`, falling back to
 * `x-real-ip`. If neither is present we deliberately do NOT fail open into
 * "unlimited" — every request with no discoverable IP shares one explicit
 * bucket, so a proxy misconfiguration degrades to a shared limit instead of no
 * limit at all.
 */
function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  if (firstHop) return firstHop;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown"; // deliberately shared bucket — see comment above
}

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
  const prefix = key ? parseKeyPrefix(key) : null;

  // Spend the pre-auth token BEFORE the key lookup below, keyed on the
  // PREFIX (never the full key or secret — this string can end up in Redis or
  // in logs) plus caller IP. A key that does not even parse still gets a
  // bucket, "malformed" (not a valid hex prefix, so it can't collide with a
  // real one), so garbage that fails to parse cannot dodge the limit by
  // construction. Every branch below — missing header, malformed key, unknown
  // prefix, wrong secret — reads identically to an attacker, on purpose.
  const preAuthNow = Date.now();
  const ip = clientIp(request);
  // Two buckets, because the prefix in the first one is attacker-controlled:
  // rotating it would otherwise buy a fresh allowance per guess. The second
  // bucket drops the prefix and so bounds what one IP can cost us in total.
  const [prefixVerdict, ipVerdict] = await Promise.all([
    rateLimit(`api:preauth:${ip}:${prefix ?? "malformed"}`, API_PRE_AUTH_RATE_LIMIT),
    rateLimit(`api:preauth:ip:${ip}`, API_PRE_AUTH_IP_RATE_LIMIT),
  ]);
  const preAuthVerdict = !prefixVerdict.success ? prefixVerdict : ipVerdict;
  if (!preAuthVerdict.success) {
    // Same response shape as the per-credential 429 below — a throttled fake
    // key and a throttled real key must be indistinguishable.
    const retryAfter = Math.max(1, Math.ceil((preAuthVerdict.resetAt - preAuthNow) / 1000));
    const res = apiError(429, "rate_limited", "Too many requests. Slow down and retry.");
    res.headers.set("Retry-After", String(retryAfter));
    return { ok: false, response: res };
  }

  if (!key) {
    return { ok: false, response: apiError(401, "unauthorized", "Missing Authorization: Bearer <api key>.") };
  }
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
      store: { select: { status: true, features: true } },
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

  // The owner's per-store switch. Read from the row already fetched above, so
  // this costs no extra query and there is nothing to invalidate: turning the
  // switch off in Stores > Edit stops the very next request.
  if (!parseFeatures(client.store.features).storefront_api_enabled) {
    apiLogger.warn({ clientId: client.id, storeId: client.storeId }, "api auth failed: store API not enabled");
    return {
      ok: false,
      response: apiError(
        403,
        "api_not_enabled",
        "The storefront API is not enabled for this store. Ask the platform owner to switch it on."
      ),
    };
  }

  if (!client.scopes.includes(scope)) {
    return { ok: false, response: apiError(403, "insufficient_scope", `This API key lacks the "${scope}" scope.`, { requiredScope: scope }) };
  }

  // Per-credential, NOT per-IP: the caller is a server, so its IP is stable and
  // its key is the only identity that matters. Keyed by bucket so a burst of
  // catalog reads cannot consume the order budget.
  //
  // This is a second, independent spend on top of the pre-auth gate above —
  // that is intentional, not a duplicate. The pre-auth gate is a cheap outer
  // wall against unauthenticated garbage; it knows nothing about who the
  // caller is. Once a request has resolved to a real, live, in-scope
  // credential, that credential's own quota still has to be enforced, or a
  // single valid key could ignore its allotted rate simply because it already
  // passed the outer gate.
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
