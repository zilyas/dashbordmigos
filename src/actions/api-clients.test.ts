import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  apiClientCreateMock,
  apiClientCountMock,
  apiClientUpdateManyMock,
  isStorefrontApiEnabledMock,
  logActivityMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  apiClientCreateMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ id: "client_1" })),
  apiClientCountMock: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0),
  apiClientUpdateManyMock: vi.fn<(...args: unknown[]) => Promise<{ count: number }>>(async () => ({ count: 1 })),
  isStorefrontApiEnabledMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  logActivityMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiClient: {
      create: apiClientCreateMock,
      count: apiClientCountMock,
      updateMany: apiClientUpdateManyMock,
    },
  },
}));

// The guard runs at module load to build the action's permission checker; the
// session it resolves to is what the WHERE clauses must be scoped by.
vi.mock("@/lib/rbac-guards", () => ({
  requireStorePermission: () => async () => ({
    userId: "u1",
    role: "MANAGER",
    storeId: "s1",
    sid: "sid1",
  }),
}));

vi.mock("@/lib/features", () => ({ isStorefrontApiEnabled: isStorefrontApiEnabledMock }));
vi.mock("@/lib/audit", () => ({ logActivity: logActivityMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

// @/lib/api/keys is deliberately NOT mocked: the real mintApiKey must run or the
// key-format and no-raw-key-persisted assertions below prove nothing.
const { createApiClient, revokeApiClient } = await import("./api-clients");

const KEY_PATTERN = /^sk_[0-9a-f]{12}_[A-Za-z0-9_-]{32,}$/;

const VALID_INPUT = {
  name: "Storefront",
  scopes: ["products:read" as const, "stock:read" as const],
  expiresInDays: 30,
};

function createCallData(): Record<string, unknown> {
  const arg = apiClientCreateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
  return arg.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClientCreateMock.mockResolvedValue({ id: "client_1" });
  apiClientCountMock.mockResolvedValue(0);
  apiClientUpdateManyMock.mockResolvedValue({ count: 1 });
  isStorefrontApiEnabledMock.mockResolvedValue(true);
});

describe("createApiClient", () => {
  it("refuses to mint when the owner switched the storefront API off after the page rendered", async () => {
    isStorefrontApiEnabledMock.mockResolvedValue(false);

    const result = await createApiClient(VALID_INPUT);

    expect(result).not.toHaveProperty("success");
    expect(result).toHaveProperty("error");
    expect(apiClientCreateMock).not.toHaveBeenCalled();
  });

  it("returns a key in the sk_<prefix>_<secret> shape the API authenticator parses", async () => {
    const result = await createApiClient(VALID_INPUT);

    if (!("success" in result)) throw new Error(`expected success, got ${result.error}`);
    expect(result.key).toMatch(KEY_PATTERN);
    expect(result.key.startsWith(`sk_${result.keyPrefix}_`)).toBe(true);
  });

  it("persists a hash of the key and never the key itself in any column", async () => {
    const result = await createApiClient(VALID_INPUT);

    if (!("success" in result)) throw new Error(`expected success, got ${result.error}`);
    const data = createCallData();
    expect(data.keyHash).toBeTruthy();
    expect(data.keyHash).not.toBe(result.key);
    // Catches a secret smuggled into any field, not just the ones named here.
    expect(JSON.stringify(data)).not.toContain(result.key);
  });

  it("refuses to mint an eleventh key while the store already has ten active ones", async () => {
    apiClientCountMock.mockResolvedValue(10);

    const result = await createApiClient(VALID_INPUT);

    expect(result).not.toHaveProperty("success");
    expect(result).toHaveProperty("error");
    expect(apiClientCreateMock).not.toHaveBeenCalled();
  });

  it("logs the creation without leaking the raw key into the audit metadata", async () => {
    const result = await createApiClient(VALID_INPUT);

    if (!("success" in result)) throw new Error(`expected success, got ${result.error}`);
    expect(logActivityMock).toHaveBeenCalledTimes(1);
    const entry = logActivityMock.mock.calls[0][0] as { metadata?: unknown };
    expect(JSON.stringify(entry.metadata ?? {})).not.toContain(result.key);
  });
});

describe("revokeApiClient", () => {
  it("scopes the revoke to the caller's own store so one store cannot kill another's key", async () => {
    await revokeApiClient("client_1");

    const arg = apiClientUpdateManyMock.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ id: "client_1", storeId: "s1" });
  });

  it("reports an error when no row matched, rather than claiming a revoke that never happened", async () => {
    apiClientUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await revokeApiClient("someone-elses-key");

    expect(result).not.toHaveProperty("success");
    expect(result).toHaveProperty("error");
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it("logs the revoke without leaking any key material into the audit metadata", async () => {
    const result = await revokeApiClient("client_1");

    expect(result).toEqual({ success: true });
    expect(logActivityMock).toHaveBeenCalledTimes(1);
    const entry = logActivityMock.mock.calls[0][0] as { metadata?: unknown; entityId?: string };
    expect(entry.entityId).toBe("client_1");
    expect(JSON.stringify(entry.metadata ?? {})).not.toMatch(/sk_[0-9a-f]{12}_/);
  });
});
