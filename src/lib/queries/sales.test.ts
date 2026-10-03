import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: { sale: { findMany: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { getSales } from "@/lib/queries/sales";

/** Minimal row in the shape `getSales`'s own `include` produces. */
function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sale-1",
    invoiceNumber: "INV-001",
    seller: { name: "Amina" },
    store: { name: "Main" },
    apiClientId: null,
    apiClient: null,
    customerName: null,
    customerPhone: null,
    subtotal: 10,
    discount: 0,
    tax: 0,
    total: 10,
    netProfit: 4,
    refundedTotal: 0,
    status: "COMPLETED",
    paymentMethod: "CASH",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  db.sale.findMany.mockReset();
});

describe("getSales api client origin", () => {
  it("surfaces the api client name for an API-created sale", async () => {
    db.sale.findMany.mockResolvedValue([
      saleRow({ apiClientId: "client-1", apiClient: { id: "client-1", name: "Shopify Storefront" } }),
    ]);

    const [sale] = await getSales({ role: "MANAGER", userId: "u1", storeId: "s1" });

    expect(sale.apiClientId).toBe("client-1");
    expect(sale.apiClientName).toBe("Shopify Storefront");
  });

  it("reports null origin for a human sale", async () => {
    db.sale.findMany.mockResolvedValue([saleRow()]);

    const [sale] = await getSales({ role: "MANAGER", userId: "u1", storeId: "s1" });

    expect(sale.apiClientId).toBeNull();
    expect(sale.apiClientName).toBeNull();
  });

  it("asks Prisma for the api client so the name is actually available", async () => {
    db.sale.findMany.mockResolvedValue([]);

    await getSales({ role: "MANAGER", userId: "u1", storeId: "s1" });

    expect(db.sale.findMany.mock.calls[0][0].include.apiClient).toEqual({
      select: { id: true, name: true },
    });
  });
});
