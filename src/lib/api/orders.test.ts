import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A key scoped to `orders:create` alone must not be able to read the catalogue
 * through error messages. The 409 pre-check writes nothing, so it is otherwise
 * a free, repeatable probe: send quantity 999999 and read back the product's
 * real name and exact stock — the whole `products:read` + `stock:read` surface
 * without holding either scope.
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    sale: { findUnique: vi.fn(async () => null) },
    store: { findUnique: vi.fn(async () => ({ id: "s1", features: {} })) },
    product: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit", () => ({ logActivity: vi.fn(async () => undefined) }));

const { createApiOrder } = await import("@/lib/api/orders");

const PRODUCT = {
  id: "p1",
  name: "Straga",
  status: "ACTIVE",
  storeId: "s1",
  trackBatch: false,
  hasVariants: false,
  allowDecimalQuantity: false,
  sellingPrice: 100,
  fabricationPrice: 40,
  stock: 3,
  variants: [],
};

function context(scopes: string[]) {
  return { clientId: "c1", storeId: "s1", actorUserId: "u1", scopes };
}
const ORDER = { idempotencyKey: "probe-0001", items: [{ productId: "p1", quantity: 999999 }] };

describe("createApiOrder error messages respect scopes", () => {
  beforeEach(() => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT] as never);
  });

  it("hides the product name and the stock level from an orders-only key", async () => {
    const result = await createApiOrder(context(["orders:create"]), ORDER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("insufficient_stock");
    expect(result.message).not.toContain("Straga");
    // The exact count is the `stock:read` surface; 3 must not appear.
    expect(result.message).not.toMatch(/\b3\b/);
    // The caller's own input is safe to echo back.
    expect(result.message).toContain("p1");
  });

  it("still names the product for a key that holds products:read", async () => {
    const result = await createApiOrder(context(["orders:create", "products:read"]), ORDER);
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toContain("Straga");
    expect(result.message).not.toMatch(/\b3\b/);
  });

  it("gives the exact stock only to a key that holds stock:read", async () => {
    const result = await createApiOrder(
      context(["orders:create", "products:read", "stock:read"]),
      ORDER
    );
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toContain("Straga");
    expect(result.message).toContain("3 available");
  });

  it("hides the name in the variant-required message too", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { ...PRODUCT, hasVariants: true, variants: [] },
    ] as never);
    const result = await createApiOrder(context(["orders:create"]), ORDER);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("variant_required");
    expect(result.message).not.toContain("Straga");
  });
});
