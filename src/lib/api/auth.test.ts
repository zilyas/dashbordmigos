import { describe, it, expect, vi, beforeEach } from "vitest";
import { mintApiKey } from "./keys";

const { apiClientFindUniqueMock, apiClientUpdateMock, rateLimitMock } = vi.hoisted(() => ({
  apiClientFindUniqueMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  apiClientUpdateMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
  // Typed with the bucket parameter so a test can vary its verdict per bucket —
  // there are now two pre-auth buckets plus the per-credential one, and the
  // per-IP ceiling can only be tested by failing one bucket and not the other.
  rateLimitMock: vi.fn<(bucket: string) => Promise<{ success: boolean; remaining: number; resetAt: number }>>(
    async () => ({ success: true, remaining: 119, resetAt: Date.now() + 60_000 })
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { apiClient: { findUnique: apiClientFindUniqueMock, update: apiClientUpdateMock } },
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/logger", () => ({ scopedLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const { authenticateApiRequest } = await import("./auth");

/** A live, in-date, fully-scoped credential. Tests vary one field at a time. */
function clientRow(
  keyHash: string,
  features: unknown = { storefront_api_enabled: true }
) {
  return {
    id: "client_1",
    storeId: "store_1",
    actorUserId: "user_1",
    scopes: ["products:read", "stock:read", "orders:create"],
    status: "ACTIVE",
    keyHash,
    expiresAt: null,
    revokedAt: null,
    store: { status: "ACTIVE", features },
    actor: { status: "ACTIVE" },
  };
}

function request(key: string) {
  return new Request("https://example.test/api/v1/products", {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("authenticateApiRequest — store feature gate", () => {
  beforeEach(() => {
    apiClientFindUniqueMock.mockReset();
    rateLimitMock.mockClear();
  });

  it("accepts a valid key when the owner has enabled the storefront API", async () => {
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash));

    const result = await authenticateApiRequest(request(key), "products:read");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.storeId).toBe("store_1");
  });

  it("rejects the same valid key with 403 api_not_enabled when the flag is off", async () => {
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash, { storefront_api_enabled: false }));

    const result = await authenticateApiRequest(request(key), "products:read");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "api_not_enabled" },
    });
  });

  it("treats a store that never saw the flag as disabled", async () => {
    // Every existing store has features: null. Defaulting to enabled here would
    // silently open the API on every store the owner never touched.
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash, null));

    const result = await authenticateApiRequest(request(key), "products:read");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("does not spend the per-credential rate budget on a request the feature gate rejects", async () => {
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash, { storefront_api_enabled: false }));

    await authenticateApiRequest(request(key), "products:read");

    // The pre-auth gate spends its two buckets (per-prefix and per-IP) before
    // the database lookup that finds the disabled feature — that is not a
    // regression, it is the new outer gate doing its job. What must NOT happen
    // is the per-credential bucket (keyed on client_1) being touched for a
    // request that never got past the store's own feature switch.
    expect(rateLimitMock).not.toHaveBeenCalledWith(expect.stringContaining("client_1"), expect.anything());
  });
});

describe("authenticateApiRequest — pre-auth rate limit gate", () => {
  beforeEach(() => {
    apiClientFindUniqueMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue({ success: true, remaining: 119, resetAt: Date.now() + 60_000 });
  });

  it("429s a fake key once the pre-auth limit is exhausted, without ever querying the database", async () => {
    const { key } = mintApiKey(); // well-formed, but no matching row — the "attacker" case
    rateLimitMock.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() + 5_000 });

    const result = await authenticateApiRequest(request(key), "products:read");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBeTruthy();
    await expect(result.response.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });

    // The whole point: a throttled request must never reach the lookup that
    // would otherwise run once per garbage key, unauthenticated and free.
    expect(apiClientFindUniqueMock).not.toHaveBeenCalled();
  });

  it("still limits a malformed key that cannot be parsed at all", async () => {
    rateLimitMock.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() + 5_000 });

    const result = await authenticateApiRequest(request("not-a-real-key"), "products:read");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(apiClientFindUniqueMock).not.toHaveBeenCalled();

    const bucketKey = (rateLimitMock.mock.calls[0] as unknown as [string, unknown])[0];
    expect(bucketKey).toContain("malformed");
  });

  it("keys the pre-auth bucket on the key PREFIX, never the secret", async () => {
    const { key, keyPrefix } = mintApiKey();

    await authenticateApiRequest(request(key), "products:read");

    const bucketKey = (rateLimitMock.mock.calls[0] as unknown as [string, unknown])[0];
    expect(bucketKey).toContain(keyPrefix);
    // The secret is everything after the second underscore-delimited segment;
    // it must never appear in a string that can land in Redis or in logs.
    const secret = key.split("_").slice(2).join("_");
    expect(bucketKey).not.toContain(secret);
  });

  it("429s on the per-IP ceiling even when every attempt uses a fresh prefix", async () => {
    // The per-prefix bucket alone is dodgeable: a new prefix per guess buys a
    // new allowance. The per-IP bucket is what actually bounds the damage, so
    // exhausting ONLY that one must still produce a 429 and still skip the DB.
    rateLimitMock.mockReset();
    rateLimitMock.mockImplementation(async (bucket: string) =>
      bucket.startsWith("api:preauth:ip:")
        ? { success: false, remaining: 0, resetAt: Date.now() + 5_000 }
        : { success: true, remaining: 19, resetAt: Date.now() + 60_000 }
    );

    const result = await authenticateApiRequest(request(mintApiKey().key), "products:read");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(apiClientFindUniqueMock).not.toHaveBeenCalled();
  });

  it("still spends the existing per-credential limit for a legitimate key (no regression)", async () => {
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash));

    const result = await authenticateApiRequest(request(key), "products:read");

    expect(result.ok).toBe(true);
    // Three spends per legitimate request is correct: the pre-auth per-prefix
    // and per-IP buckets first, then the per-credential bucket once the key is
    // verified. Assert the buckets by name rather than by count, so adding a
    // gate later does not fail a test about per-credential enforcement.
    const bucketKeys = rateLimitMock.mock.calls.map((call) => String((call as unknown as [string, unknown])[0]));
    expect(bucketKeys.some((k) => k.startsWith("api:preauth:ip:"))).toBe(true);
    expect(bucketKeys.some((k) => k.startsWith("api:preauth:") && !k.startsWith("api:preauth:ip:"))).toBe(true);
    expect(bucketKeys).toContainEqual("api:read:client_1");
  });
});
