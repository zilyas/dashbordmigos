import { describe, expect, it, vi } from "vitest";

// Only Prisma is mocked. `@/lib/api/auth` itself runs for real, so this test
// exercises the actual `apiRoute` wrapper and the actual error envelope rather
// than a stand-in for them — mocking the module under test would have made the
// x-request-id assertions below assert nothing. Prisma must still be stubbed
// because auth.ts imports it at module load and this project's DATABASE_URL
// points at a live production database.
vi.mock("@/lib/prisma", () => ({
  prisma: { apiClient: { findUnique: vi.fn(), update: vi.fn() } },
}));

const { GET, POST } = await import("./route");

function req(headers: Record<string, string> = {}) {
  return new Request("https://x.test/api/v1/does-not-exist", { headers });
}

describe("catch-all /api/* 404", () => {
  it("returns the standard JSON error envelope with a JSON content-type", async () => {
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("is uncacheable", async () => {
    expect((await GET(req())).headers.get("Cache-Control")).toBe("no-store");
  });

  it("carries an x-request-id on every response", async () => {
    expect((await GET(req())).headers.get("x-request-id")).toBeTruthy();
  });

  it("echoes a caller-supplied x-request-id instead of minting a new one", async () => {
    const res = await POST(req({ "x-request-id": "trace-abc-123" }));
    expect(res.headers.get("x-request-id")).toBe("trace-abc-123");
  });
});
