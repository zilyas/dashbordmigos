/**
 * Regression cover for the Sept 2026 POS incident: `createSale`'s outermost
 * catch was a bare `catch {}`, so a sale that died inside the transaction
 * produced ONE opaque string and no server-side trace whatsoever. The real
 * cause (migration 20260924180000_invoice_sequence never applied in
 * production, so `invoiceSequence.upsert` raised Prisma P2021) was
 * undiagnosable from either side.
 *
 * Two things are asserted here, and they pull in opposite directions on
 * purpose: EVERYTHING goes to the server log, NOTHING extra goes to the
 * client. `@/lib/prisma` is mocked wholesale — this project's DATABASE_URL
 * points at a live production database and no test may ever reach it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, logServerErrorMock, warnMock } = vi.hoisted(() => ({
  db: {
    store: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    variantAxisDefinition: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    notification: { createMany: vi.fn() },
    sale: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  logServerErrorMock: vi.fn<(scope: string, error: unknown, context?: Record<string, unknown>) => Promise<void>>(
    async () => undefined
  ),
  warnMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({
  logServerError: logServerErrorMock,
  scopedLogger: () => ({ warn: warnMock, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/store-context", () => ({
  getSessionContext: vi.fn(async () => ({ userId: "user-1", role: "MANAGER", storeId: "store-1", sid: "sid-1" })),
  requireStoreId: (c: { storeId: string }) => c.storeId,
}));
vi.mock("@/lib/audit", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { createSale } from "@/actions/sales";

const INPUT = {
  customerName: "",
  customerPhone: "",
  discountPercent: 0,
  paymentMethod: "CASH" as const,
  items: [{ productId: "prod-1", quantity: 2 }],
};

const PRODUCT = {
  id: "prod-1", name: "Widget", sku: "W-1", hasVariants: false, variants: [],
  sellingPrice: new Prisma.Decimal(10), fabricationPrice: new Prisma.Decimal(4),
  stock: new Prisma.Decimal(50), minimumStock: new Prisma.Decimal(1),
  trackBatch: false, trackExpiry: false, allowDecimalQuantity: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.store.findUnique.mockResolvedValue({
    id: "store-1", timezone: "UTC", taxRate: new Prisma.Decimal(0), features: {},
  });
  db.product.findMany.mockResolvedValue([PRODUCT]);
});

describe("createSale error handling", () => {
  it("logs the cause with context and still returns a generic message", async () => {
    const boom = new Error("connection terminated unexpectedly");
    db.$transaction.mockRejectedValue(boom);

    const result = await createSale(INPUT);

    expect(logServerErrorMock).toHaveBeenCalledTimes(1);
    const [scope, error, context] = logServerErrorMock.mock.calls[0];
    expect(scope).toBe("app");
    expect(error).toBe(boom);
    expect(context).toMatchObject({
      action: "sale.create", storeId: "store-1", userId: "user-1", lineCount: 1, schemaMismatch: false,
    });
    expect(result).toEqual({ error: "Failed to complete sale. Please try again." });
  });

  it("tells the user not to retry when the deployed schema is missing a table", async () => {
    // Exactly the production failure: invoice_sequences does not exist.
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("The table `public.invoice_sequences` does not exist", {
        code: "P2021", clientVersion: "test", meta: { table: "public.invoice_sequences" },
      })
    );

    const result = await createSale(INPUT);

    expect(logServerErrorMock).toHaveBeenCalledTimes(1);
    expect(logServerErrorMock.mock.calls[0][2]).toMatchObject({ schemaMismatch: true });
    expect(result.error).toContain("contact an administrator");
    expect(result.error).not.toMatch(/try again/i);
  });

  it("never leaks internals into the string the POS renders", async () => {
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("The table `public.invoice_sequences` does not exist", {
        code: "P2021", clientVersion: "test", meta: { table: "public.invoice_sequences" },
      })
    );

    const generic = await createSale(INPUT);
    db.$transaction.mockRejectedValue(new Error("select * from invoice_sequences failed\n  at tx (prisma.js:1)"));
    const other = await createSale(INPUT);

    for (const message of [generic.error ?? "", other.error ?? ""]) {
      expect(message).not.toMatch(/P20\d\d|invoice_sequences|prisma|select |\bat \w+\.js/i);
    }
  });

  it("warns instead of swallowing when low-stock notifications fail", async () => {
    db.$transaction.mockResolvedValue({ id: "sale-1", invoiceNumber: "INV-000007" });
    // First call resolves the cart's products; the post-sale re-read throws.
    db.product.findMany
      .mockResolvedValueOnce([PRODUCT])
      .mockRejectedValueOnce(new Error("notification lookup failed"));

    const result = await createSale(INPUT);

    expect(result).toMatchObject({ success: true, saleId: "sale-1" });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatchObject({ action: "sale.lowStockNotify", saleId: "sale-1" });
    expect(logServerErrorMock).not.toHaveBeenCalled();
  });
});

/**
 * Regression cover for the Oct 2026 POS incident: a cart holding several
 * variants of the SAME product was rejected with "One or more products could
 * not be found". `productIds` was a raw `.map()` over the cart lines, so four
 * sweeter variants produced four identical ids, `findMany` returned the one
 * product row, and `4 !== 1` failed the guard. A real, in-stock sale blocked
 * by an arithmetic mistake rather than by missing data.
 */
describe("createSale with several variants of one product", () => {
  const VARIANT_PRODUCT = {
    id: "prod-v", name: "sweeter", sku: "S-01", hasVariants: true,
    sellingPrice: new Prisma.Decimal(200), fabricationPrice: new Prisma.Decimal(80),
    stock: new Prisma.Decimal(0), minimumStock: new Prisma.Decimal(1),
    trackBatch: false, trackExpiry: false, allowDecimalQuantity: false,
    variants: ["S", "M", "L", "XL"].map((s) => ({
      id: `var-${s}`, sku: `S-01-${s}`, isActive: true,
      stock: new Prisma.Decimal(10), sellingPrice: null, fabricationPrice: null,
      size: { name: s }, color: { name: "Black" }, axisValues: null,
    })),
  };

  const FOUR_VARIANT_CART = {
    ...INPUT,
    items: ["S", "M", "L", "XL"].map((s) => ({
      productId: "prod-v", variantId: `var-${s}`, quantity: 1,
    })),
  };

  it("does not reject four lines of one product as missing products", async () => {
    db.product.findMany.mockResolvedValue([VARIANT_PRODUCT]);
    db.$transaction.mockResolvedValue({ id: "sale-9", invoiceNumber: "INV-000009" });

    const result = await createSale(FOUR_VARIANT_CART);

    expect(result).not.toMatchObject({ error: "One or more products could not be found" });
    expect(result).toMatchObject({ success: true });
  });

  it("queries each product id once, however many lines reference it", async () => {
    db.product.findMany.mockResolvedValue([VARIANT_PRODUCT]);
    db.$transaction.mockResolvedValue({ id: "sale-9", invoiceNumber: "INV-000009" });

    await createSale(FOUR_VARIANT_CART);

    // De-duplicated: the guard compares against distinct ids, so the `in` list
    // must carry one entry even though the cart has four lines.
    expect(db.product.findMany.mock.calls[0][0].where.id.in).toEqual(["prod-v"]);
  });

  it("still rejects a cart naming a product that really is absent", async () => {
    // The guard must keep working — de-duplicating must not weaken it.
    db.product.findMany.mockResolvedValue([]);

    const result = await createSale(FOUR_VARIANT_CART);

    expect(result).toEqual({ error: "One or more products could not be found" });
  });
});
