import { describe, it, expect, beforeAll } from "vitest";
import {
  CLOCK_SKEW_SECONDS,
  LEASE_TTL_SECONDS,
  buildLeasePayload,
  importLeasePublicKey,
  saleWithinLeaseWindow,
  signLease,
  verifyLease,
} from "@/lib/offline/lease";

// Real WebCrypto, no mocks: a mocked crypto test proves nothing about crypto.
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-01T09:00:00.000Z");

let privateKey: CryptoKey;
let publicKeyB64: string;
let otherPublicKeyB64: string;

function b64(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  privateKey = pair.privateKey;
  publicKeyB64 = b64(await crypto.subtle.exportKey("spki", pair.publicKey));

  const other = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  otherPublicKeyB64 = b64(await crypto.subtle.exportKey("spki", other.publicKey));
});

async function lease(at: Date = T0, sub = "user-1", storeId = "store-1") {
  const payload = buildLeasePayload(sub, storeId, "SELLER", at);
  return { payload, token: await signLease(payload, privateKey) };
}

describe("token format", () => {
  it("is v1.<base64url payload>.<base64url sig>", async () => {
    const { token } = await lease();
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("exp is iat + 7 days, in seconds", async () => {
    const { payload } = await lease();
    expect(payload.exp - payload.iat).toBe(LEASE_TTL_SECONDS);
    expect(payload.iat).toBe(Math.floor(T0.getTime() / 1000));
  });
});

describe("verifyLease", () => {
  it("round-trips a freshly signed lease", async () => {
    const { token, payload } = await lease();
    const result = await verifyLease(token, publicKeyB64, new Date(T0.getTime() + DAY));
    expect(result.status).toBe("valid");
    if (result.status === "valid") expect(result.payload).toEqual(payload);
  });

  it("rejects an expired lease and surfaces the expiry date", async () => {
    const { token, payload } = await lease();
    const result = await verifyLease(token, publicKeyB64, new Date(T0.getTime() + 8 * DAY));
    expect(result.status).toBe("expired");
    if (result.status === "expired") {
      expect(result.expiresAt.getTime()).toBe(payload.exp * 1000);
    }
  });

  it("rejects a tampered payload", async () => {
    const { token, payload } = await lease();
    const forged = { ...payload, exp: payload.exp + 30 * DAY / 1000 };
    const body = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `v1.${body}.${token.split(".")[2]}`;
    expect((await verifyLease(tampered, publicKeyB64, T0)).status).toBe("bad_signature");
  });

  it("rejects a tampered signature", async () => {
    const { token } = await lease();
    const [v, body, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A");
    expect((await verifyLease(`${v}.${body}.${flipped}`, publicKeyB64, T0)).status).toBe(
      "bad_signature"
    );
  });

  it("rejects a lease signed by a different key", async () => {
    const { token } = await lease();
    expect((await verifyLease(token, otherPublicKeyB64, T0)).status).toBe("bad_signature");
  });

  it("rejects a genuine lease presented by the wrong user", async () => {
    const { token } = await lease(T0, "user-1");
    const result = await verifyLease(token, publicKeyB64, T0, { userId: "user-2" });
    expect(result.status).toBe("wrong_user");
  });

  it("rejects a genuine lease presented for the wrong store", async () => {
    const { token } = await lease(T0, "user-1", "store-1");
    const result = await verifyLease(token, publicKeyB64, T0, {
      userId: "user-1",
      storeId: "store-2",
    });
    expect(result.status).toBe("wrong_user");
  });

  it("reports malformed input instead of throwing", async () => {
    for (const bad of ["", "nope", "v2.a.b", "v1.a", "v1.!!!.!!!"]) {
      const result = await verifyLease(bad, publicKeyB64, T0);
      expect(["malformed", "bad_signature"]).toContain(result.status);
    }
  });

  it("accepts an already-imported CryptoKey", async () => {
    const { token } = await lease();
    const key = await importLeasePublicKey(publicKeyB64);
    expect((await verifyLease(token, key, T0)).status).toBe("valid");
  });

  it("reports malformed, with no key material, for an unusable public key", async () => {
    const { token } = await lease();
    const result = await verifyLease(token, "not-a-key", T0);
    expect(result.status).toBe("malformed");
    if (result.status === "malformed") expect(result.reason).not.toContain("not-a-key");
  });
});

describe("saleWithinLeaseWindow", () => {
  it("a sale made on day 6 still syncs on day 9", async () => {
    // The regression that silently destroys a day's takings: bounding the window
    // by upload time instead of by when the sale happened.
    const { payload } = await lease();
    const saleOnDay6 = new Date(T0.getTime() + 6 * DAY);
    const uploadOnDay9 = new Date(T0.getTime() + 9 * DAY);
    expect(saleWithinLeaseWindow(payload, saleOnDay6, uploadOnDay9)).toEqual({ ok: true });
  });

  it("rejects a sale dated after the lease expired, however early it uploads", async () => {
    const { payload } = await lease();
    const saleOnDay8 = new Date(T0.getTime() + 8 * DAY);
    expect(saleWithinLeaseWindow(payload, saleOnDay8, new Date(T0.getTime() + 8.1 * DAY))).toEqual({
      ok: false,
      reason: "sale_outside_lease",
    });
  });

  it("rejects a future-dated sale", async () => {
    const { payload } = await lease();
    const sale = new Date(T0.getTime() + 2 * DAY);
    const now = new Date(T0.getTime() + DAY);
    expect(saleWithinLeaseWindow(payload, sale, now)).toEqual({ ok: false, reason: "sale_in_future" });
  });

  it("accepts ±5 min skew at both edges", async () => {
    const { payload } = await lease();
    const skew = CLOCK_SKEW_SECONDS * 1000;
    const later = new Date(T0.getTime() + 30 * DAY);

    const justBeforeIat = new Date(payload.iat * 1000 - skew + 1000);
    const justAfterExp = new Date(payload.exp * 1000 + skew - 1000);
    expect(saleWithinLeaseWindow(payload, justBeforeIat, later)).toEqual({ ok: true });
    expect(saleWithinLeaseWindow(payload, justAfterExp, later)).toEqual({ ok: true });

    const tooEarly = new Date(payload.iat * 1000 - skew - 60_000);
    const tooLate = new Date(payload.exp * 1000 + skew + 60_000);
    expect(saleWithinLeaseWindow(payload, tooEarly, later).ok).toBe(false);
    expect(saleWithinLeaseWindow(payload, tooLate, later).ok).toBe(false);
  });

  it("tolerates a till clock up to 5 min fast", async () => {
    const { payload } = await lease();
    const now = new Date(T0.getTime() + DAY);
    const slightlyAhead = new Date(now.getTime() + 4 * 60_000);
    expect(saleWithinLeaseWindow(payload, slightlyAhead, now)).toEqual({ ok: true });
  });
});

describe("keys unset means offline is off, not a crash", () => {
  it("importing lease-server with no key leaves offline disabled", async () => {
    const previous = process.env.OFFLINE_LEASE_PRIVATE_KEY;
    delete process.env.OFFLINE_LEASE_PRIVATE_KEY;
    try {
      // Importing must not throw, even with nothing configured.
      const mod = await import("@/lib/offline/lease-server");
      expect(mod.offlineLeaseEnabled()).toBe(false);
      expect(await mod.getOfflineLeasePublicKeyBase64()).toBeNull();

      const { token } = await lease();
      const verdict = await mod.verifyLeaseForSync(token, {
        userId: "user-1",
        storeId: "store-1",
        saleCreatedAt: new Date(T0.getTime() + DAY),
      });
      expect(verdict).toEqual({ accepted: false, reason: "offline_disabled" });
    } finally {
      if (previous === undefined) delete process.env.OFFLINE_LEASE_PRIVATE_KEY;
      else process.env.OFFLINE_LEASE_PRIVATE_KEY = previous;
    }
  });

  it("a malformed key value degrades to disabled rather than throwing", async () => {
    const previous = process.env.OFFLINE_LEASE_PRIVATE_KEY;
    process.env.OFFLINE_LEASE_PRIVATE_KEY = "this-is-not-a-pkcs8-key";
    try {
      const mod = await import("@/lib/offline/lease-server");
      expect(mod.offlineLeaseEnabled()).toBe(true);
      expect(await mod.getOfflineLeasePublicKeyBase64()).toBeNull();

      const { token } = await lease();
      const verdict = await mod.verifyLeaseForSync(token, {
        userId: "user-1",
        storeId: "store-1",
        saleCreatedAt: new Date(T0.getTime() + DAY),
      });
      expect(verdict).toEqual({ accepted: false, reason: "key_unusable" });
    } finally {
      if (previous === undefined) delete process.env.OFFLINE_LEASE_PRIVATE_KEY;
      else process.env.OFFLINE_LEASE_PRIVATE_KEY = previous;
    }
  });
});

describe("verifyLeaseForSync with a configured key", () => {
  // Keys here are generated per-run test keys; no real key material in the repo.
  async function withKey<T>(fn: (mod: typeof import("@/lib/offline/lease-server")) => Promise<T>) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const previous = process.env.OFFLINE_LEASE_PRIVATE_KEY;
    process.env.OFFLINE_LEASE_PRIVATE_KEY = pkcs8;
    try {
      const mod = await import("@/lib/offline/lease-server");
      return await fn(mod);
    } finally {
      if (previous === undefined) delete process.env.OFFLINE_LEASE_PRIVATE_KEY;
      else process.env.OFFLINE_LEASE_PRIVATE_KEY = previous;
    }
  }

  it("derives the public key from the private key and accepts a day-6 sale on day 9", async () => {
    await withKey(async (mod) => {
      const spki = await mod.getOfflineLeasePublicKeyBase64();
      expect(spki).toBeTruthy();

      const key = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(atob(process.env.OFFLINE_LEASE_PRIVATE_KEY!), (c) =>
          c.charCodeAt(0)
        ) as unknown as ArrayBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      );
      const payload = buildLeasePayload("user-1", "store-1", "SELLER", T0);
      const token = await signLease(payload, key);

      const verdict = await mod.verifyLeaseForSync(
        token,
        {
          userId: "user-1",
          storeId: "store-1",
          saleCreatedAt: new Date(T0.getTime() + 6 * DAY),
        },
        new Date(T0.getTime() + 9 * DAY)
      );
      expect(verdict.accepted).toBe(true);

      const wrongUser = await mod.verifyLeaseForSync(
        token,
        { userId: "user-2", storeId: "store-1", saleCreatedAt: new Date(T0.getTime() + DAY) },
        new Date(T0.getTime() + 2 * DAY)
      );
      expect(wrongUser).toMatchObject({ accepted: false, reason: "wrong_user" });

      const future = await mod.verifyLeaseForSync(
        token,
        { userId: "user-1", storeId: "store-1", saleCreatedAt: new Date(T0.getTime() + 3 * DAY) },
        new Date(T0.getTime() + DAY)
      );
      expect(future).toMatchObject({ accepted: false, reason: "sale_in_future" });
    });
  });
});
