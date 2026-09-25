import { describe, expect, it, vi } from "vitest";

// Prisma only. `apiRoute` / `methodNotAllowed` themselves run for real — they
// are what is under test here. Prisma must be stubbed because auth.ts imports
// it at module load and this project's DATABASE_URL points at a live
// production database.
vi.mock("@/lib/prisma", () => ({
  prisma: { apiClient: { findUnique: vi.fn(), update: vi.fn() } },
}));

const { apiRoute, methodNotAllowed } = await import("./auth");
const { NextResponse } = await import("next/server");

function req(headers: Record<string, string> = {}) {
  return new Request("https://x.test/api/v1/products", { method: "PUT", headers });
}

describe("apiRoute", () => {
  it("stamps x-request-id on a response the handler never touched", async () => {
    const handler = apiRoute(async () => NextResponse.json({ data: 1 }));
    expect((await handler(req())).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes the caller's own id so their trace and ours join up", async () => {
    const handler = apiRoute(async () => NextResponse.json({ data: 1 }));
    expect((await handler(req({ "x-request-id": "caller-7" }))).headers.get("x-request-id")).toBe("caller-7");
  });

  it("refuses a hostile inbound id rather than echoing it into a header", async () => {
    const handler = apiRoute(async () => NextResponse.json({ data: 1 }));
    const id = (await handler(req({ "x-request-id": "a".repeat(400) }))).headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("hands the handler the same id it puts on the response, so logs can be matched to it", async () => {
    let seen: string | null = null;
    const handler = apiRoute(async (_r, requestId) => {
      seen = requestId;
      return NextResponse.json({ data: 1 });
    });
    const res = await handler(req());
    expect(seen).toBe(res.headers.get("x-request-id"));
  });
});

describe("methodNotAllowed", () => {
  it("returns a parseable JSON body, not Next's empty 405", async () => {
    const res = methodNotAllowed("GET");
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });

  it("advertises the allowed method in the Allow header, as HTTP requires for a 405", () => {
    expect(methodNotAllowed("POST").headers.get("Allow")).toBe("POST");
  });
});

describe("real v1 routes reject an unsupported method with JSON", () => {
  it("PUT /api/v1/products is a 405 with a body and an Allow header", async () => {
    const { PUT } = await import("@/app/api/v1/products/route");
    const res = await PUT();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });

  it("GET /api/v1/orders is a 405 — orders is POST-only", async () => {
    const { GET } = await import("@/app/api/v1/orders/route");
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
