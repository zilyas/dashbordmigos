/**
 * Cover for the three behaviour changes `createSaleCore` adds over the action
 * body it was lifted from: till idempotency, the offline price override, and
 * the INACTIVE-store refusal.
 *
 * `@/lib/prisma` is mocked wholesale — this project's DATABASE_URL points at a
 * live production database and no test may ever reach it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    store: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    variantAxisDefinition: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    notification: { createMany: vi.fn() },
    sale: { findUnique: vi.fn<(args: { where: { storeId_idempotencyKey: { storeId: string; idempotencyKey: string } } }) => Promise<Record<string, unknown> | null>>(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({
  logServerError: vi.fn(async () => undefined),
  scopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/audit", () => ({ logActivity: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { createSaleCore } from "@/lib/sales/create-sale";
import { hashSaleBody } from "@/lib/api/idempotency";

const CONTEXT = { userId: "user-1", role: "MANAGER" as const, storeId: "store-1" };

const INPUT = {
  customerName: "",
  customerPhone: "",
  discountPercent: 0,
  paymentMethod: "CASH" as const,
  // 2 x 120 = 240, no tax: the Casablanca bag from the override comment.
  items: [{ productId: "prod-1", quantity: 2 }],
};

const PRODUCT = {
  id: "prod-1", name: "Widget", sku: "W-1", hasVariants: false, variants: [],
  sellingPrice: new Prisma.Decimal(120), fabricationPrice: new Prisma.Decimal(40),
  stock: new Prisma.Decimal(50), minimumStock: new Prisma.Decimal(1),
  trackBatch: false, trackExpiry: false, allowDecimalQuantity: false,
};

/** The money row the core handed `sale.create`, as plain numbers. */
function writtenSaleData() {
  const tx = {
    productBatch: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    invoiceSequence: { upsert: vi.fn(async () => ({ nextValue: 7 })) },
    sale: { create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "sale-1", invoiceNumber: "INV-000007", ...args.data })) },
    saleItem: { create: vi.fn(async () => ({ id: "item-1" })) },
    saleItemBatchAllocation: { create: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    product: { update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    productVariant: { updateMany: vi.fn(async () => ({ count: 1 })) },
    activityLog: { create: vi.fn() },
  };
  db.$transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(tx));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.store.findUnique.mockResolvedValue({
    id: "store-1", status: "ACTIVE", timezone: "UTC", taxRate: new Prisma.Decimal(0), features: {},
  });
  db.product.findMany.mockResolvedValue([PRODUCT]);
  db.sale.findUnique.mockResolvedValue(null);
});

describe("INACTIVE store", () => {
  it("refuses to record a sale at a deactivated store", async () => {
    db.store.findUnique.mockResolvedValue({
      id: "store-1", status: "INACTIVE", timezone: "UTC", taxRate: new Prisma.Decimal(0), features: {},
    });

    const result = await createSaleCore(CONTEXT, INPUT);

    expect(result).toMatchObject({ ok: false, code: "store_inactive" });
    // Nothing may be written: the point is that stock stops moving too.
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("till idempotency", () => {
  it("returns the original sale when the same clientSaleId replays the same body", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-first", invoiceNumber: "INV-000003",
      total: new Prisma.Decimal(240), idempotencyHash: hashSaleBody(CONTEXT.userId, INPUT),
    });

    const result = await createSaleCore(CONTEXT, INPUT, { clientSaleId: "uuid-a" });

    expect(result).toMatchObject({ ok: true, replayed: true, saleId: "sale-first", invoiceNumber: "INV-000003" });
    // The whole point: stock is decremented once, not once per retry.
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.sale.findUnique.mock.calls[0]?.[0].where.storeId_idempotencyKey).toEqual({
      storeId: "store-1", idempotencyKey: "pos:uuid-a",
    });
  });

  it("refuses the same clientSaleId carrying a different basket", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-first", invoiceNumber: "INV-000003",
      total: new Prisma.Decimal(240), idempotencyHash: hashSaleBody(CONTEXT.userId, INPUT),
    });

    const result = await createSaleCore(
      CONTEXT,
      { ...INPUT, items: [{ productId: "prod-1", quantity: 5 }] },
      { clientSaleId: "uuid-a" }
    );

    // The first sale must NOT come back: that would silently drop the second.
    expect(result).toMatchObject({ ok: false, code: "idempotency_conflict" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses the same clientSaleId reused by a different cashier", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-first", invoiceNumber: "INV-000003",
      total: new Prisma.Decimal(240), idempotencyHash: hashSaleBody("user-2", INPUT),
    });

    const result = await createSaleCore(CONTEXT, INPUT, { clientSaleId: "uuid-a" });

    expect(result).toMatchObject({ ok: false, code: "idempotency_conflict" });
  });

  it("stores the key and the body hash on a first, non-replayed sale", async () => {
    const tx = writtenSaleData();

    const result = await createSaleCore(CONTEXT, INPUT, { clientSaleId: "uuid-a" });

    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(tx.sale.create.mock.calls[0][0].data).toMatchObject({
      idempotencyKey: "pos:uuid-a",
      idempotencyHash: hashSaleBody(CONTEXT.userId, INPUT),
    });
  });

  it("hands back the winner as a replay when a concurrent till wins the P2002 race", async () => {
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002", clientVersion: "test", meta: { target: ["storeId", "idempotencyKey"] },
      })
    );
    db.sale.findUnique
      .mockResolvedValueOnce(null) // pre-check: nothing there yet
      .mockResolvedValueOnce({
        id: "sale-winner", invoiceNumber: "INV-000008",
        total: new Prisma.Decimal(240), idempotencyHash: hashSaleBody(CONTEXT.userId, INPUT),
      });

    const result = await createSaleCore(CONTEXT, INPUT, { clientSaleId: "uuid-a" });

    expect(result).toMatchObject({ ok: true, replayed: true, saleId: "sale-winner" });
  });
});

describe("offline price override", () => {
  it("records the total the cashier actually charged when the catalogue moved under it", async () => {
    const tx = writtenSaleData();

    // Took 200 on Thursday; the catalogue now says 240. The drawer holds 200.
    const result = await createSaleCore(CONTEXT, INPUT, { offline: true, expectedTotal: 200 });

    expect(result).toMatchObject({ ok: true, total: 200 });
    const data = tx.sale.create.mock.calls[0][0].data as Record<string, number>;
    expect(data.total).toBe(200);
    // The money row must stay internally consistent — every revenue aggregate
    // reads these columns directly.
    expect(Number(data.subtotal) - Number(data.discount) + Number(data.tax)).toBeCloseTo(200, 2);
  });

  it("refuses an implausible override and reports the server total", async () => {
    writtenSaleData();

    // 20 against a catalogue 240 is not a price change.
    const result = await createSaleCore(CONTEXT, INPUT, { offline: true, expectedTotal: 20 });

    expect(result).toMatchObject({ ok: false, code: "price_changed", serverTotal: 240 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("ignores expectedTotal entirely when the sale is not offline", async () => {
    const tx = writtenSaleData();

    // The action path never sets `offline`, so the catalogue total must win
    // even if an expectedTotal somehow reaches here.
    const result = await createSaleCore(CONTEXT, INPUT, { expectedTotal: 200 });

    expect(result).toMatchObject({ ok: true, total: 240 });
    expect(Number((tx.sale.create.mock.calls[0][0].data as Record<string, number>).total)).toBe(240);
  });
});
