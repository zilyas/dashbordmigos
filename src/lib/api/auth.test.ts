import { describe, it, expect, vi, beforeEach } from "vitest";
import { mintApiKey } from "./keys";

const { apiClientFindUniqueMock, apiClientUpdateMock, rateLimitMock } = vi.hoisted(() => ({
  apiClientFindUniqueMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  apiClientUpdateMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
  rateLimitMock: vi.fn(async () => ({ success: true, remaining: 119, resetAt: Date.now() + 60_000 })),
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

  it("does not spend rate budget on a request the feature gate rejects", async () => {
    const { key, keyHash } = mintApiKey();
    apiClientFindUniqueMock.mockResolvedValue(clientRow(keyHash, { storefront_api_enabled: false }));

    await authenticateApiRequest(request(key), "products:read");

    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});
