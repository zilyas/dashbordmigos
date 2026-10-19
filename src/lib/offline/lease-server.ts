/**
 * Server-only half of the offline lease: eligibility, issuing, and the sync-time
 * gate. May import Prisma. Never import this from a client component.
 *
 * This file is THE security boundary for offline selling. The browser-side check
 * in ./lease.ts is a convenience that keeps honest tills honest; everything in
 * IndexedDB is editable by the staff member at the till. `verifyLeaseForSync` is
 * the only thing an attacker cannot edit, so it is the only real enforcement.
 */

import {
  buildLeasePayload,
  importLeasePrivateKey,
  saleWithinLeaseWindow,
  signLease,
  verifyLease,
  type LeasePayload,
} from "@/lib/offline/lease";

/* ---------- key material ---------- */
/*
 * OFFLINE_LEASE_PRIVATE_KEY is a server runtime secret (base64 PKCS#8). It is
 * read lazily, inside functions — never at module scope — so that:
 *   - a deployment that has not configured offline mode still boots, and the
 *     online POS is completely unaffected (keys unset => offline mode is OFF);
 *   - the key is never captured into a module constant that could be bundled.
 * The PUBLIC key is derived from it here and handed to the client in the POS
 * snapshot payload at request time. It is deliberately NOT a NEXT_PUBLIC_*
 * build-time variable: baking it into the bundle (as this project stopped doing
 * in c61cb20) would make rotation need a full rebuild and image prune.
 */

/** True when offline mode is configured at all. Unset key => offline simply off. */
export function offlineLeaseEnabled(): boolean {
  return (process.env.OFFLINE_LEASE_PRIVATE_KEY ?? "").trim().length > 0;
}

function privateKeyRaw(): string | null {
  const raw = (process.env.OFFLINE_LEASE_PRIVATE_KEY ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/**
 * The lease signing key's public half, base64 SPKI — this is what the snapshot
 * route (`GET /api/pos/offline`, a later task) sends to the till.
 *
 * Returns null when offline mode is not configured, or when the configured key
 * is unusable. Never throws, and never includes key material in any message:
 * a misconfigured deployment degrades to "offline off", it does not break.
 */
export async function getOfflineLeasePublicKeyBase64(): Promise<string | null> {
  const raw = privateKeyRaw();
  if (!raw) return null;
  try {
    // Import extractable, drop the private scalar `d`, re-import the remaining
    // public point, and export SPKI. WebCrypto has no direct pkcs8 -> spki path.
    const pkcs8 = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const priv = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8 as unknown as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );
    const jwk = await crypto.subtle.exportKey("jwk", priv);
    const pub = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pub));
    let s = "";
    for (const b of spki) s += String.fromCharCode(b);
    return btoa(s);
  } catch {
    return null;
  }
}

/* ---------- eligibility ---------- */

export type OfflineEligibility =
  | { eligible: true; role: string }
  | { eligible: false; reason: "offline_disabled" | "user_inactive" | "store_inactive" | "not_found" };

/**
 * The single gate for "may this user sell offline?". Deliberately the ONE place
 * that knowledge lives — callers (issuing, the snapshot route, sync) ask this
 * and nothing else.
 *
 * Today the only gates are `User.status` and `Store.status` (both ACTIVE =
 * allowed). There is no subscription or billing model in this schema. When one
 * arrives, add the check HERE — e.g. load the store's subscription and return
 * `{ eligible: false, reason: "subscription_inactive" }` — and every caller
 * inherits it without changing a line. That is why the result is a widening
 * discriminated union rather than a boolean.
 */
export async function checkOfflineEligibility(
  userId: string,
  storeId: string
): Promise<OfflineEligibility> {
  if (!offlineLeaseEnabled()) return { eligible: false, reason: "offline_disabled" };

  // Imported lazily so the crypto half of this module can be exercised (and the
  // "keys unset" path tested) without ever constructing a DB client.
  const { prisma } = await import("@/lib/prisma");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, role: true, storeId: true },
  });
  if (!user || user.storeId !== storeId) return { eligible: false, reason: "not_found" };
  if (user.status !== "ACTIVE") return { eligible: false, reason: "user_inactive" };

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { status: true },
  });
  if (!store) return { eligible: false, reason: "not_found" };
  if (store.status !== "ACTIVE") return { eligible: false, reason: "store_inactive" };

  return { eligible: true, role: user.role };
}

/* ---------- issuing ---------- */

export type IssueResult =
  | { ok: true; token: string; payload: LeasePayload }
  | {
      ok: false;
      reason:
        | "offline_disabled"
        | "user_inactive"
        | "store_inactive"
        | "not_found"
        | "key_unusable";
    };

/**
 * Sign a 7-day lease, but only after `checkOfflineEligibility` passes. Returns a
 * reason instead of throwing so a route can answer "offline not available" the
 * same way whether the cause is config, a suspended store, or a bad key.
 */
export async function issueLease(
  userId: string,
  storeId: string,
  role: string,
  issuedAt: Date = new Date()
): Promise<IssueResult> {
  const eligibility = await checkOfflineEligibility(userId, storeId);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };

  const raw = privateKeyRaw();
  if (!raw) return { ok: false, reason: "key_unusable" };
  try {
    const key = await importLeasePrivateKey(raw);
    const payload = buildLeasePayload(userId, storeId, role, issuedAt);
    return { ok: true, token: await signLease(payload, key), payload };
  } catch {
    // Config error, not key material: say nothing about the value.
    return { ok: false, reason: "key_unusable" };
  }
}

/* ---------- sync-time enforcement (the real boundary) ---------- */

export type SyncVerdict =
  | { accepted: true; payload: LeasePayload }
  | {
      accepted: false;
      reason:
        | "offline_disabled"
        | "key_unusable"
        | "bad_signature"
        | "malformed"
        | "wrong_user"
        | "expired"
        | "sale_in_future"
        | "sale_outside_lease";
      /** Present when the lease parsed: lets the API explain when the window closed. */
      expiresAt?: Date;
    };

/**
 * THE enforcement point. Runs on the server when a till uploads offline sales.
 *
 * Checks, in order: a genuine signature from our key; `sub` is the syncing user;
 * `storeId` matches; and the SALE'S OWN timestamp sits inside the lease window
 * (±5 min skew) and is not in the future.
 *
 * Note what is NOT checked: whether the lease has expired *by now*. A sale made
 * on day 6 of the lease must still sync when the till reconnects on day 9 — the
 * window bounds when selling was authorised, not when the upload lands. Flipping
 * that would silently drop a day of real takings.
 */
export async function verifyLeaseForSync(
  token: string,
  args: { userId: string; storeId: string; saleCreatedAt: Date },
  now: Date = new Date()
): Promise<SyncVerdict> {
  if (!offlineLeaseEnabled()) return { accepted: false, reason: "offline_disabled" };
  const publicKey = await getOfflineLeasePublicKeyBase64();
  if (!publicKey) return { accepted: false, reason: "key_unusable" };

  // Verify at the lease's own issue time so an old-but-genuine lease still
  // validates structurally; the sale-window check below is what bounds it.
  const result = await verifyLease(token, publicKey, new Date(0), {
    userId: args.userId,
    storeId: args.storeId,
  });

  switch (result.status) {
    case "bad_signature":
      return { accepted: false, reason: "bad_signature" };
    case "malformed":
      return { accepted: false, reason: "malformed" };
    case "wrong_user":
      return { accepted: false, reason: "wrong_user" };
    case "expired":
      // Unreachable with `new Date(0)` as `now`, but keep the branch honest.
      return { accepted: false, reason: "expired", expiresAt: result.expiresAt };
    case "valid": {
      const window = saleWithinLeaseWindow(result.payload, args.saleCreatedAt, now);
      if (!window.ok) {
        return {
          accepted: false,
          reason: window.reason,
          expiresAt: new Date(result.payload.exp * 1000),
        };
      }
      return { accepted: true, payload: result.payload };
    }
  }
}
