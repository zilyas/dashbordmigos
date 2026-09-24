import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    sale: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
    store: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    saleItem: { create: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ logActivity: vi.fn() }));

const { decrementProductStock } = vi.hoisted(() => ({ decrementProductStock: vi.fn() }));
vi.mock("@/lib/inventory", () => ({
  decrementProductStock,
  decrementVariantStock: vi.fn(async () => true),
}));

import { createApiOrder } from "@/lib/api/orders";
import { hashOrderBody } from "@/lib/api/idempotency";
import type { ApiClientContext } from "@/lib/api/auth";
import type { ApiOrderInput } from "@/lib/validations/api-order";

const ORDERS_ONLY: ApiClientContext = {
  clientId: "c1",
  storeId: "s1",
  actorUserId: "u1",
  scopes: ["orders:create"],
};
const FULL_SCOPE: ApiClientContext = { ...ORDERS_ONLY, scopes: ["orders:create", "products:read", "stock:read"] };

const INPUT: ApiOrderInput = {
  idempotencyKey: "key-12345678",
  items: [{ productId: "p1", quantity: 2 }],
};

function stubCreatePath(stock: number) {
  db.sale.findUnique.mockResolvedValue(null);
  db.store.findUnique.mockResolvedValue({ id: "s1", taxRate: 0, features: null });
  db.product.findMany.mockResolvedValue([
    {
      id: "p1",
      name: "Secret Hoodie",
      stock,
      sellingPrice: 100,
      fabricationPrice: 40,
      hasVariants: false,
      trackBatch: false,
      unit: null,
      variants: [],
    },
  ]);
  db.sale.count.mockResolvedValue(0);
  db.sale.create.mockResolvedValue({ id: "sale-1", invoiceNumber: "INV-000001", total: 200, createdAt: new Date() });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
}

beforeEach(() => {
  vi.clearAllMocks();
  decrementProductStock.mockResolvedValue(true);
});

describe("idempotency key reuse", () => {
  it("replays when the stored hash matches the body", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-1",
      invoiceNumber: "INV-000001",
      total: 200,
      createdAt: new Date(),
      idempotencyHash: hashOrderBody(INPUT),
    });

    const res = await createApiOrder(ORDERS_ONLY, INPUT);
    expect(res).toMatchObject({ ok: true, replayed: true });
  });

  it("rejects the same key used for a DIFFERENT body with 409 idempotency_key_reused", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-1",
      invoiceNumber: "INV-000001",
      total: 200,
      createdAt: new Date(),
      // hash of a different basket
      idempotencyHash: hashOrderBody({ ...INPUT, items: [{ productId: "p9", quantity: 1 }] }),
    });

    const res = await createApiOrder(ORDERS_ONLY, INPUT);
    expect(res).toMatchObject({ ok: false, status: 409, code: "idempotency_key_reused" });
  });

  it("accepts a legacy row that has no stored hash", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-1",
      invoiceNumber: "INV-000001",
      total: 200,
      createdAt: new Date(),
      idempotencyHash: null,
    });

    const res = await createApiOrder(ORDERS_ONLY, INPUT);
    expect(res).toMatchObject({ ok: true, replayed: true });
  });

  it("stores the body hash on a new sale", async () => {
    stubCreatePath(10);
    const res = await createApiOrder(ORDERS_ONLY, INPUT);
    expect(res).toMatchObject({ ok: true, replayed: false });
    expect(db.sale.create.mock.calls[0][0].data.idempotencyHash).toBe(hashOrderBody(INPUT));
  });

  it("treats a reordered items array as the same request", () => {
    const a: ApiOrderInput = { idempotencyKey: "k-12345678", items: [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }] };
    const b: ApiOrderInput = { idempotencyKey: "k-12345678", items: [{ productId: "b", quantity: 2 }, { productId: "a", quantity: 1 }] };
    expect(hashOrderBody(a)).toBe(hashOrderBody(b));
  });
});
describe("in-transaction insufficient_stock message", () => {
  it("leaks neither name nor stock to an orders-only key", async () => {
    // Pre-check passes (stock looks fine), the in-transaction guard loses the race.
    stubCreatePath(10);
    decrementProductStock.mockResolvedValue(false);

    const res = await createApiOrder(ORDERS_ONLY, INPUT);
    expect(res).toMatchObject({ ok: false, status: 409, code: "insufficient_stock" });
    if (res.ok) throw new Error("unreachable");
    expect(res.message).not.toContain("Secret Hoodie");
    expect(res.message).not.toContain("10");
    expect(res.message).toContain("product p1");
  });

  it("still shows name and stock to a key that holds both read scopes", async () => {
    stubCreatePath(10);
    decrementProductStock.mockResolvedValue(false);

    const res = await createApiOrder(FULL_SCOPE, INPUT);
    if (res.ok) throw new Error("unreachable");
    expect(res.message).toContain("Secret Hoodie");
    expect(res.message).toContain("10 available");
  });
});
