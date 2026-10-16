import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    product: { findMany: vi.fn() },
    productVariant: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { getProducts } from "@/lib/queries/products";

/** Minimal row in the shape `getProducts`'s own `include` produces. */
function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    sku: "S-01",
    barcode: null,
    name: "sweeter",
    categoryId: null,
    category: null,
    type: "SIMPLE",
    size: null,
    color: null,
    hasVariants: false,
    unit: "piece",
    fabricationPrice: 50,
    sellingPrice: 100,
    profitMargin: 50,
    stock: 0,
    minimumStock: 1,
    status: "ACTIVE",
    images: [],
    variants: [],
    _count: { variants: 0 },
    createdAt: new Date("2026-09-20T17:43:34.611Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.productVariant.groupBy.mockResolvedValue([]);
});

/**
 * Regression tests for the stock figure this page reports.
 *
 * A WaaS integrator found /api/v1/stock returning `available: 80` and `97` for
 * two products this page displayed as "0 units". The API was right. A sale
 * decrements `ProductVariant.stock` and never writes the parent
 * `Product.stock` column, so for a variant product that column is a dead
 * number the page was rendering anyway.
 *
 * If one of these fails, the Products page and the storefront API have drifted
 * apart again, and a shop owner is reading a stock figure that is not true.
 */
describe("getProducts stock", () => {
  it("sums live variants for a variant product, ignoring the stale parent column", async () => {
    // The exact shape of the reported bug: parent says 0, variants hold 80.
    db.product.findMany.mockResolvedValue([
      productRow({ hasVariants: true, stock: 0, _count: { variants: 8 } }),
    ]);
    db.productVariant.groupBy.mockResolvedValue([{ productId: "p1", _sum: { stock: 80 } }]);

    const [product] = await getProducts("store-1");

    expect(product.stock).toBe(80);
  });

  it("keeps the parent column for a simple product", async () => {
    // No variants, so the parent column IS the live figure and must be used.
    db.product.findMany.mockResolvedValue([productRow({ hasVariants: false, stock: 12 })]);

    const [product] = await getProducts("store-1");

    expect(product.stock).toBe(12);
    // No variant products in the page, so the aggregate must be skipped
    // entirely rather than issuing a query with an empty `in` list.
    expect(db.productVariant.groupBy).not.toHaveBeenCalled();
  });

  it("reports 0 for a variant product whose variants are all deactivated", async () => {
    // groupBy returns no row at all when nothing matches `isActive: true`.
    // Falling back to the parent column here would revive the stale number.
    db.product.findMany.mockResolvedValue([
      productRow({ hasVariants: true, stock: 99, _count: { variants: 3 } }),
    ]);
    db.productVariant.groupBy.mockResolvedValue([]);

    const [product] = await getProducts("store-1");

    expect(product.stock).toBe(0);
  });

  it("counts only active variants, matching the storefront API's filter", async () => {
    db.product.findMany.mockResolvedValue([
      productRow({ hasVariants: true, stock: 0, _count: { variants: 2 } }),
    ]);
    db.productVariant.groupBy.mockResolvedValue([{ productId: "p1", _sum: { stock: 19 } }]);

    await getProducts("store-1");

    // /api/v1/products and /api/v1/stock both sum `isActive: true` variants.
    // A different filter here is how the two surfaces drift apart again.
    expect(db.productVariant.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        _sum: { stock: true },
      })
    );
  });

  it("maps each product to its own variant sum", async () => {
    db.product.findMany.mockResolvedValue([
      productRow({ id: "p1", hasVariants: true, stock: 0 }),
      productRow({ id: "p2", sku: "T-01", hasVariants: true, stock: 0 }),
      productRow({ id: "p3", sku: "X-01", hasVariants: false, stock: 7 }),
    ]);
    db.productVariant.groupBy.mockResolvedValue([
      { productId: "p2", _sum: { stock: 97 } },
      { productId: "p1", _sum: { stock: 80 } },
    ]);

    const products = await getProducts("store-1");

    expect(products.map((p) => p.stock)).toEqual([80, 97, 7]);
  });
});
