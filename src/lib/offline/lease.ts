/**
 * Offline-lease crypto + validation. Isomorphic: this module runs unchanged in
 * the browser (POS till) and on the server (issuing + sync enforcement). It uses
 * only WebCrypto (`globalThis.crypto.subtle`), which Node 24 exposes globally —
 * never `node:crypto`, or the client bundle breaks.
 *
 * SECURITY BOUNDARY, read this before trusting anything here:
 * verifying a lease IN THE BROWSER is a CONVENIENCE. The till's IndexedDB, its
 * clock and this code are all editable by the person standing at it (the threat
 * model is the shop's own staff with devtools open, not a remote attacker). A
 * client-side `valid` result means "this honest till may keep selling", nothing
 * more. The ONLY real enforcement is `verifyLeaseForSync` in ./lease-server.ts,
 * which runs on the server at sync time with a trusted clock. Do not add a
 * control here and then believe it is enforced.
 *
 * All times in a lease payload are UNIX SECONDS (not milliseconds).
 */

/** Lease lifetime: 7 days, in seconds. */
export const LEASE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Clock skew tolerated when judging a sale's own timestamp, in seconds. */
export const CLOCK_SKEW_SECONDS = 5 * 60;

export type LeasePayload = {
  /** Format version. Bump when the payload shape changes. */
  v: 1;
  /** Subject: the user id the lease was issued to. */
  sub: string;
  storeId: string;
  role: string;
  /** Issued at, UNIX SECONDS. */
  iat: number;
  /** Expires at, UNIX SECONDS. Always `iat + LEASE_TTL_SECONDS`. */
  exp: number;
};

/**
 * Discriminated result, deliberately not a boolean: the UI has to explain
 * itself ("your offline window ended on Friday" vs "this device's lease is
 * damaged, reconnect to get a new one").
 */
export type LeaseVerification =
  | { status: "valid"; payload: LeasePayload }
  | { status: "expired"; payload: LeasePayload; expiresAt: Date }
  | { status: "bad_signature" }
  | { status: "malformed"; reason: string }
  | { status: "wrong_user"; payload: LeasePayload };

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

/* ---------- base64 / base64url, no Buffer so this stays isomorphic ---------- */

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/* ---------- key import ---------- */

/** @param pkcs8Base64 base64 PKCS#8. Server-only secret — never ship to a client. */
export function importLeasePrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(pkcs8Base64) as unknown as ArrayBuffer,
    ALGORITHM,
    false,
    ["sign"]
  );
}

/** @param spkiBase64 base64 SPKI. Safe to hand to the client in the snapshot payload. */
export function importLeasePublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64) as unknown as ArrayBuffer,
    ALGORITHM,
    true,
    ["verify"]
  );
}

/* ---------- sign / verify ---------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Token format: `v1.<base64url(payload JSON)>.<base64url(ECDSA P-256 sig)>` */
export async function signLease(payload: LeasePayload, privateKey: CryptoKey): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    SIGN_PARAMS,
    privateKey,
    encoder.encode(`v1.${body}`) as unknown as ArrayBuffer
  );
  return `v1.${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Build a 7-day payload. `iat` defaults to now, in seconds. */
export function buildLeasePayload(
  sub: string,
  storeId: string,
  role: string,
  issuedAt: Date = new Date()
): LeasePayload {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return { v: 1, sub, storeId, role, iat, exp: iat + LEASE_TTL_SECONDS };
}

function parsePayload(raw: string): LeasePayload | null {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(fromBase64Url(raw)));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (
    p.v !== 1 ||
    typeof p.sub !== "string" ||
    typeof p.storeId !== "string" ||
    typeof p.role !== "string" ||
    typeof p.iat !== "number" ||
    typeof p.exp !== "number" ||
    !Number.isFinite(p.iat) ||
    !Number.isFinite(p.exp)
  ) {
    return null;
  }
  return { v: 1, sub: p.sub, storeId: p.storeId, role: p.role, iat: p.iat, exp: p.exp };
}

/**
 * Verify a lease token's signature and (optionally) its subject/store, then its
 * expiry against `now`.
 *
 * Signature comparison happens inside `crypto.subtle.verify`, which is already
 * constant-time. Nothing here hand-rolls a comparison of key or signature bytes.
 *
 * @param publicKeyRaw base64 SPKI public key, or an already-imported CryptoKey.
 * @param expected when given, a payload for a different user/store comes back
 *   as `wrong_user` instead of `valid` — a genuine lease belonging to someone
 *   else is then useless.
 */
export async function verifyLease(
  token: string,
  publicKeyRaw: string | CryptoKey,
  now: Date = new Date(),
  expected?: { userId?: string; storeId?: string }
): Promise<LeaseVerification> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { status: "malformed", reason: "token is not v1.<payload>.<sig>" };
  }
  const [, body, sig] = parts;

  let key: CryptoKey;
  try {
    key =
      typeof publicKeyRaw === "string" ? await importLeasePublicKey(publicKeyRaw) : publicKeyRaw;
  } catch {
    // Never echo key material in an error — only that it would not import.
    return { status: "malformed", reason: "public key is not importable base64 SPKI" };
  }

  let signatureOk: boolean;
  try {
    signatureOk = await crypto.subtle.verify(
      SIGN_PARAMS,
      key,
      fromBase64Url(sig) as unknown as ArrayBuffer,
      encoder.encode(`v1.${body}`) as unknown as ArrayBuffer
    );
  } catch {
    return { status: "bad_signature" };
  }
  if (!signatureOk) return { status: "bad_signature" };

  // Only now is the payload trustworthy enough to read.
  const payload = parsePayload(body);
  if (!payload) return { status: "malformed", reason: "payload is not a v1 lease" };

  if (
    (expected?.userId !== undefined && expected.userId !== payload.sub) ||
    (expected?.storeId !== undefined && expected.storeId !== payload.storeId)
  ) {
    return { status: "wrong_user", payload };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds > payload.exp) {
    return { status: "expired", payload, expiresAt: new Date(payload.exp * 1000) };
  }
  return { status: "valid", payload };
}

/* ---------- sale window ---------- */

export type SaleWindowCheck =
  | { ok: true }
  | { ok: false; reason: "sale_in_future" | "sale_outside_lease" };

/**
 * Does a sale's OWN timestamp fall inside the lease window?
 *
 * This is the subtle one. The window applies to WHEN THE SALE HAPPENED, never to
 * when the upload arrives: a till that sells on day 6 and only reconnects on
 * day 9 must still sync that sale. Checking the window against upload time would
 * silently destroy a day's takings. `now` is used ONLY to reject sales dated in
 * the future (a till with its clock pushed forward), never to bound the window.
 *
 * Both edges allow CLOCK_SKEW_SECONDS, so a till a few minutes off still syncs.
 */
export function saleWithinLeaseWindow(
  payload: LeasePayload,
  saleCreatedAt: Date,
  now: Date = new Date()
): SaleWindowCheck {
  const sale = Math.floor(saleCreatedAt.getTime() / 1000);
  if (!Number.isFinite(sale)) return { ok: false, reason: "sale_in_future" };
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (sale > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: "sale_in_future" };
  if (sale < payload.iat - CLOCK_SKEW_SECONDS || sale > payload.exp + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "sale_outside_lease" };
  }
  return { ok: true };
}
