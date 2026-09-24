import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: findManyMock } },
}));

vi.mock("@/lib/logger", () => ({
  logServerError: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateApiRequest: vi.fn(async () => ({
    ok: true,
    context: { clientId: "c1", storeId: "s1", actorUserId: "u1", scopes: ["stock:read"] },
  })),
  apiError: (status: number, code: string, message: string) =>
    NextResponse.json({ error: { code, message } }, { status }),
  noStore: <T extends NextResponse>(res: T): T => {
    res.headers.set("Cache-Control", "no-store");
    return res;
  },
}));

import { GET } from "./route";

function product(id: string, updatedAt = new Date("2026-01-01T00:00:00Z")) {
  return { id, sku: `sku-${id}`, stock: 5, hasVariants: false, updatedAt, variants: [] };
}

function req(qs: string) {
  return new Request(`https://x.test/api/v1/stock?${qs}`, { headers: { authorization: "Bearer sk_x" } });
}

describe("GET /api/v1/stock", () => {
  it("A: paginates updatedSince — hasMore true, nextCursor is last returned row, data trimmed to limit", async () => {
    const limit = 3;
    findManyMock.mockResolvedValueOnce([
      product("p1"), product("p2"), product("p3"), product("p4"), // limit+1
    ]);

    const res = await GET(req(`updatedSince=2026-01-01T00:00:00Z&limit=${limit}`));
    const body = await res.json();

    expect(body.data).toHaveLength(limit);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("p3");
  });

  it("B: fewer than limit+1 rows — hasMore false, nextCursor null", async () => {
    findManyMock.mockResolvedValueOnce([product("p1"), product("p2")]);

    const res = await GET(req("updatedSince=2026-01-01T00:00:00Z&limit=5"));
    const body = await res.json();

    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.data).toHaveLength(2);
  });

  it("C: cursor forwarded as { id: cursor } with skip: 1", async () => {
    findManyMock.mockResolvedValueOnce([product("p1")]);

    await GET(req("updatedSince=2026-01-01T00:00:00Z&cursor=abc"));

    const call = findManyMock.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: "abc" });
    expect(call.skip).toBe(1);
  });

  it("D: limit=9999 is clamped to MAX_LIMIT (200) for take", async () => {
    findManyMock.mockResolvedValueOnce([product("p1")]);

    await GET(req("updatedSince=2026-01-01T00:00:00Z&limit=9999"));

    const call = findManyMock.mock.calls[0][0];
    expect(call.take).toBe(201); // MAX_LIMIT + 1 probe row
  });

  it("rejects cursor combined with ids", async () => {
    const res = await GET(req("ids=p1,p2&cursor=abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_parameter");
  });
});
