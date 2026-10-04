/**
 * ============================================================================
 *  PUBLIC API CONTRACT TEST — READ THIS BEFORE YOU "FIX" A FAILURE HERE
 * ============================================================================
 *
 * WHAT THIS FILE IS
 * -----------------
 * `/api/v1/**` is consumed by external e-commerce sites we do not own and
 * cannot redeploy. Their code names our fields literally: `row.price`,
 * `body.nextCursor`, `err.error.code`. Once a storefront ships against this
 * JSON, the shape of that JSON stops being ours to change quietly — it is
 * frozen by THEIR code, not ours.
 *
 * Every other test in this repo asks "does the handler still work?". This one
 * asks a different, narrower question: "is the bytes-on-the-wire shape still
 * EXACTLY what integrators were promised?" So the assertions here are
 * deliberately, unusually strict — they compare the FULL, SORTED key set at
 * every level of every response body, not just the presence of the keys the
 * test happens to care about. That strictness is the entire point:
 *
 *   - rename `price` to `unitPrice`  -> FAILS here (key missing + key added)
 *   - drop `barcode`                 -> FAILS here
 *   - leak a new internal field      -> FAILS here (an added key is a FAILURE,
 *                                       not a pass; `fabricationPrice` or
 *                                       `profit` escaping into the catalogue
 *                                       response is a data-disclosure bug)
 *   - forget `Number(decimal)`       -> FAILS here (Prisma `Decimal`
 *                                       serializes to a JSON *string*, so a
 *                                       dropped conversion silently turns
 *                                       `price: 19.99` into `price: "19.99"`
 *                                       and breaks every consumer's
 *                                       arithmetic without breaking any other
 *                                       test in this repo)
 *
 * The fixtures below therefore hand the routes real `Prisma.Decimal` and real
 * `Date` instances — the same types the live database returns — so the
 * serialization step is genuinely exercised rather than assumed.
 *
 * IF A TEST IN THIS FILE FAILS
 * ----------------------------
 * The default assumption is NOT "this test is stale". The default assumption
 * is "we are about to break production integrations". Before you touch a
 * single assertion, work out which of these three you are in:
 *
 *   1. ADDITIVE change (a brand-new optional field, a brand-new endpoint).
 *      Backward compatible. Update the expected key set in the same commit as
 *      the route change, and add it to `docs/storefront-api.md`.
 *
 *   2. BREAKING change (rename, removal, type change, status-code change,
 *      pagination-semantics change). This needs a deliberate decision, not a
 *      test edit: a new API version, a migration note in
 *      `docs/storefront-api.md`, and integrators told BEFORE it ships. Editing
 *      this file to make the suite green is how a live storefront finds out by
 *      going down on a Saturday.
 *
 *   3. ACCIDENT. Someone refactored a response mapper and did not realise this
 *      is a published contract. Revert the mapper, not the test.
 *
 * `docs/storefront-api.md` is the prose version of this contract. This file is
 * the enforced version. When the two disagree, the SOURCE wins and the doc is
 * a bug — but a failure here means the source itself moved, which is the
 * serious case.
 *
 * HOW IT IS WIRED (and why it touches no database)
 * ------------------------------------------------
 * Only `@/lib/prisma`, `@/lib/inventory` and `@/lib/audit` are mocked.
 * `@/lib/api/auth` runs FOR REAL — a key is minted with the real
 * `mintApiKey()` and its real hash is handed back by the mocked
 * `apiClient.findUnique` — because the auth layer is where the error envelope,
 * the `x-request-id` stamp and the scope responses actually come from.
 * Stubbing it would mean the error-contract assertions below assert nothing.
 * (Contrast `stock/route.test.ts`, which stubs auth on purpose because it is
 * testing pagination arithmetic, not the envelope.)
 *
 * This project's `DATABASE_URL` points at a LIVE PRODUCTION database with real
 * stock and real sales. Nothing in this file may ever reach it — in
 * particular the order tests below must never execute a real write, or they
 * would decrement real inventory. That is why Prisma is mocked wholesale and
 * `$transaction` is a plain local function call.
 * ============================================================================
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    apiClient: { findUnique: vi.fn(), update: vi.fn() },
    product: { findMany: vi.fn() },
    sale: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    store: { findUnique: vi.fn() },
    invoiceSequence: { upsert: vi.fn() },
    saleItem: { createMany: vi.fn() },
    inventoryMovement: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/inventory", () => ({
  decrementProductStock: vi.fn(async () => true),
  decrementVariantStock: vi.fn(async () => true),
}));

import { Prisma } from "@/generated/prisma/client";
import { mintApiKey } from "@/lib/api/keys";
import { hashOrderBody } from "@/lib/api/idempotency";
import { GET as productsGET, POST as productsPOST } from "@/app/api/v1/products/route";
import { GET as stockGET } from "@/app/api/v1/stock/route";
import { POST as ordersPOST } from "@/app/api/v1/orders/route";
import { GET as catchAllGET } from "@/app/api/[...catchAll]/route";

// ── The contract, written down once ─────────────────────────────────────────
// Sorted, exhaustive key sets. A rename shows up as one key missing AND one
// key added; an accidental leak shows up as one key added. Both fail.

const PRODUCTS_ENVELOPE = ["data", "nextCursor", "syncedAt"];
const PRODUCT_ROW = [
  "barcode", "category", "description", "hasVariants", "id", "images",
  "name", "price", "slug", "sku", "stock", "unit", "updatedAt", "variants",
].sort();
const PRODUCT_VARIANT = ["barcode", "id", "imageUrl", "price", "sku", "stock"].sort();
const CATEGORY = ["id", "name", "slug"].sort();

const STOCK_ENVELOPE = ["data", "hasMore", "nextCursor", "syncedAt"].sort();
const STOCK_ROW = ["available", "productId", "sku", "updatedAt", "variants"].sort();
const STOCK_VARIANT = ["available", "sku", "updatedAt", "variantId"].sort();

const ORDER_ENVELOPE = ["data"];
const ORDER_DATA = ["createdAt", "id", "invoiceNumber", "replayed", "total"].sort();

const ERROR_ENVELOPE = ["error"];
const ERROR_FIELDS = ["code", "message"];

/** A `Date` must leave the API as a full ISO 8601 instant in the `Z` zone. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const keys = (o: object) => Object.keys(o).sort();

// ── Request plumbing ────────────────────────────────────────────────────────

const KEY = mintApiKey();

/**
 * A fresh client id and caller IP per authorization. Both rate limiters in
 * `auth.ts` (per-credential, and the pre-auth per-IP/prefix pair) are real
 * here, so reusing one identity across every test in the file would eventually
 * answer 429 and the failure would look like a contract break instead of a
 * test-fixture problem.
 */
let seq = 0;

function clientRow(scopes: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: `client-${seq}`,
    storeId: "store-1",
    actorUserId: "user-1",
    scopes,
    status: "ACTIVE",
    keyHash: KEY.keyHash,
    expiresAt: null,
    revokedAt: null,
    store: { status: "ACTIVE", features: { storefront_api_enabled: true } },
    actor: { status: "ACTIVE" },
    ...overrides,
  };
}

function authorize(scopes: string[], overrides: Record<string, unknown> = {}) {
  seq += 1;
  db.apiClient.findUnique.mockResolvedValue(clientRow(scopes, overrides));
}

function req(path: string, init: RequestInit & { anonymous?: boolean } = {}) {
  const { anonymous, ...rest } = init;
  return new Request(`https://x.test${path}`, {
    ...rest,
    headers: {
      ...(anonymous ? {} : { authorization: `Bearer ${KEY.key}` }),
      "x-forwarded-for": `10.0.0.${seq}`,
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
}

// ── Database row fixtures (real Decimal / Date, as Prisma returns them) ─────

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    sku: "TS-BLK-M",
    barcode: "0123456789012",
    name: "Black T-Shirt",
    slug: "black-t-shirt",
    description: "100% cotton crew neck.",
    sellingPrice: new Prisma.Decimal("19.99"),
    stock: new Prisma.Decimal("42"),
    unit: "piece",
    hasVariants: false,
    updatedAt: new Date("2026-09-20T14:03:11.000Z"),
    category: { id: "cat-1", name: "Apparel", slug: "apparel" },
    images: [{ url: "https://cdn.example.com/ts-blk.jpg" }],
    variants: [],
    ...overrides,
  };
}

function variantRow(id: string, stock: string, price: string | null = "24.50") {
  return {
    id,
    sku: `${id}-SKU`,
    barcode: `bar-${id}`,
    sellingPrice: price === null ? null : new Prisma.Decimal(price),
    stock: new Prisma.Decimal(stock),
    imageUrl: null,
    updatedAt: new Date("2026-09-20T14:03:11.000Z"),
  };
}

function stockRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sku: `${id}-SKU`,
    stock: new Prisma.Decimal("42"),
    hasVariants: false,
    updatedAt: new Date("2026-09-20T14:03:11.000Z"),
    variants: [],
    ...overrides,
  };
}

const ORDER_BODY = { idempotencyKey: "order-8f3a1c2d-0001", items: [{ productId: "p1", quantity: 2 }] };

function orderReq(body: unknown = ORDER_BODY) {
  return req("/api/v1/orders", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Stubs the whole create path of `createApiOrder` — no DB, no real writes. */
function stubOrderCreate(stock: string) {
  db.sale.findUnique.mockResolvedValue(null);
  db.store.findUnique.mockResolvedValue({ id: "store-1", taxRate: new Prisma.Decimal("0"), features: null });
  db.product.findMany.mockResolvedValue([
    {
      id: "p1",
      name: "Black T-Shirt",
      stock: new Prisma.Decimal(stock),
      sellingPrice: new Prisma.Decimal("19.99"),
      fabricationPrice: new Prisma.Decimal("8.00"),
      hasVariants: false,
      trackBatch: false,
      allowDecimalQuantity: false,
      unit: "piece",
      variants: [],
    },
  ]);
  db.invoiceSequence.upsert.mockResolvedValue({ nextValue: 7 });
  db.sale.create.mockResolvedValue({
    id: "sale-1",
    invoiceNumber: "INV-000007",
    // A real Decimal: `toSummary()` must convert it, or `total` ships as a string.
    total: new Prisma.Decimal("39.98"),
    createdAt: new Date("2026-09-25T09:12:03.000Z"),
  });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.apiClient.update.mockResolvedValue({});
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/v1/products
// ════════════════════════════════════════════════════════════════════════════

describe("CONTRACT GET /api/v1/products", () => {
  it("envelope is exactly { data, nextCursor, syncedAt } — note: no hasMore", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow()]);

    const res = await productsGET(req("/api/v1/products"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(keys(body)).toEqual(PRODUCTS_ENVELOPE);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.syncedAt).toMatch(ISO_8601);
  });

  it("each data row has exactly the 14 documented keys", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow()]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;
    expect(keys(row)).toEqual(PRODUCT_ROW);
  });

  it("row field types are locked (price/stock numbers, updatedAt ISO, nullable strings)", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow()]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;

    expect(typeof row.id).toBe("string");
    expect(typeof row.sku).toBe("string");
    expect(typeof row.barcode === "string" || row.barcode === null).toBe(true);
    expect(typeof row.name).toBe("string");
    expect(typeof row.slug).toBe("string");
    expect(typeof row.description === "string" || row.description === null).toBe(true);
    // The Decimal -> number conversions. A string here breaks consumer arithmetic.
    expect(typeof row.price).toBe("number");
    expect(row.price).toBe(19.99);
    expect(typeof row.stock).toBe("number");
    expect(row.stock).toBe(42);
    expect(typeof row.unit === "string" || row.unit === null).toBe(true);
    expect(typeof row.hasVariants).toBe("boolean");
    expect(Array.isArray(row.images)).toBe(true);
    expect(row.images.every((i: unknown) => typeof i === "string")).toBe(true);
    expect(Array.isArray(row.variants)).toBe(true);
    expect(row.updatedAt).toMatch(ISO_8601);
  });

  it("category is exactly { id, name, slug }, and null when unset", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow(), productRow({ id: "p2", category: null })]);

    const { data } = await (await productsGET(req("/api/v1/products"))).json();
    expect(keys(data[0].category)).toEqual(CATEGORY);
    expect(typeof data[0].category.id).toBe("string");
    expect(typeof data[0].category.name).toBe("string");
    expect(typeof data[0].category.slug).toBe("string");
    expect(data[1].category).toBeNull();
  });

  it("each variant has exactly { id, sku, barcode, price, stock, imageUrl } with locked types", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([
      productRow({ hasVariants: true, variants: [variantRow("v1", "4"), variantRow("v2", "3")] }),
    ]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;
    expect(row.variants).toHaveLength(2);
    for (const v of row.variants) {
      expect(keys(v)).toEqual(PRODUCT_VARIANT);
      expect(typeof v.id).toBe("string");
      expect(typeof v.sku).toBe("string");
      expect(typeof v.barcode === "string" || v.barcode === null).toBe(true);
      expect(typeof v.price).toBe("number");
      expect(typeof v.stock).toBe("number");
      expect(typeof v.imageUrl === "string" || v.imageUrl === null).toBe(true);
    }
  });

  it("a variant with no price of its own inherits the parent price as a number", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([
      productRow({ hasVariants: true, variants: [variantRow("v1", "4", null)] }),
    ]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;
    expect(row.variants[0].price).toBe(19.99);
  });

  it("stock on a variant product is the SUM of live variants, not the stale parent column", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([
      // Parent column says 42 and is stale by design; variants hold 4 + 3.
      productRow({ hasVariants: true, variants: [variantRow("v1", "4"), variantRow("v2", "3")] }),
    ]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;
    expect(row.stock).toBe(7);
  });

  it("never leaks a cost or profit field, even if one is selected upstream", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([
      productRow({ fabricationPrice: new Prisma.Decimal("8.00"), profitMargin: new Prisma.Decimal("50") }),
    ]);

    const [row] = (await (await productsGET(req("/api/v1/products"))).json()).data;
    // The exact key set above already proves this; asserted by name too because
    // THIS is the leak that matters most if the mapper is ever loosened.
    expect(keys(row)).toEqual(PRODUCT_ROW);
    expect(row).not.toHaveProperty("fabricationPrice");
    expect(row).not.toHaveProperty("profit");
    expect(row).not.toHaveProperty("profitMargin");
  });

  it("PAGINATION: end of walk is signalled by nextCursor === null (never by a hasMore flag)", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow(), productRow({ id: "p2" })]);

    const body = await (await productsGET(req("/api/v1/products?limit=5"))).json();
    expect(body.nextCursor).toBeNull();
    expect(body).not.toHaveProperty("hasMore");
    expect(body.data).toHaveLength(2);
  });

  it("PAGINATION: more rows available -> nextCursor is the last RETURNED row's id, as a string", async () => {
    authorize(["products:read"]);
    // limit+1 rows: the probe row must be trimmed, not returned.
    db.product.findMany.mockResolvedValue([
      productRow({ id: "p1" }), productRow({ id: "p2" }), productRow({ id: "p3" }),
    ]);

    const body = await (await productsGET(req("/api/v1/products?limit=2"))).json();
    expect(body.data).toHaveLength(2);
    expect(typeof body.nextCursor).toBe("string");
    expect(body.nextCursor).toBe("p2");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/v1/stock
// ════════════════════════════════════════════════════════════════════════════

describe("CONTRACT GET /api/v1/stock", () => {
  it("envelope is exactly { data, hasMore, nextCursor, syncedAt } with locked types", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([stockRow("p1")]);

    const res = await stockGET(req("/api/v1/stock?updatedSince=2026-01-01T00:00:00Z"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(keys(body)).toEqual(STOCK_ENVELOPE);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
    expect(body.syncedAt).toMatch(ISO_8601);
  });

  it("each data row has exactly { productId, sku, available, variants, updatedAt } with locked types", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([stockRow("p1")]);

    const [row] = (await (await stockGET(req("/api/v1/stock?ids=p1"))).json()).data;

    expect(keys(row)).toEqual(STOCK_ROW);
    expect(typeof row.productId).toBe("string");
    expect(typeof row.sku).toBe("string");
    expect(typeof row.available).toBe("number");
    expect(row.available).toBe(42);
    expect(Array.isArray(row.variants)).toBe(true);
    expect(row.updatedAt).toMatch(ISO_8601);
    // The id field is `productId` here and `id` on /products. Deliberate, and
    // load-bearing in integrator code — do not "harmonise" it without a version.
    expect(row).not.toHaveProperty("id");
  });

  it("each variant has exactly { variantId, sku, available, updatedAt } with locked types", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([
      stockRow("p1", { hasVariants: true, variants: [variantRow("v1", "4"), variantRow("v2", "3")] }),
    ]);

    const [row] = (await (await stockGET(req("/api/v1/stock?ids=p1"))).json()).data;
    expect(row.variants).toHaveLength(2);
    for (const v of row.variants) {
      expect(keys(v)).toEqual(STOCK_VARIANT);
      expect(typeof v.variantId).toBe("string");
      expect(typeof v.sku).toBe("string");
      expect(typeof v.available).toBe("number");
      expect(v.updatedAt).toMatch(ISO_8601);
    }
  });

  it("available on a variant product is the SUM of live variants", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([
      stockRow("p1", { hasVariants: true, variants: [variantRow("v1", "4"), variantRow("v2", "3")] }),
    ]);

    const [row] = (await (await stockGET(req("/api/v1/stock?ids=p1"))).json()).data;
    expect(row.available).toBe(7);
  });

  it("PAGINATION ASYMMETRY: in ids mode hasMore is ALWAYS false and nextCursor ALWAYS null", async () => {
    authorize(["stock:read"]);
    // Far more rows than the default limit of 50 — ids mode still reports a
    // single complete page, because the id list is its own bound. An integrator
    // codes `while (hasMore)` against this; it must never start looping here.
    db.product.findMany.mockResolvedValue(Array.from({ length: 60 }, (_, i) => stockRow(`p${i}`)));

    const body = await (await stockGET(req("/api/v1/stock?ids=p0,p1,p2"))).json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.data).toHaveLength(60);
  });

  it("PAGINATION: updatedSince mode signals a further page with hasMore true + a string nextCursor", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([stockRow("p1"), stockRow("p2"), stockRow("p3")]);

    const body = await (await stockGET(req("/api/v1/stock?updatedSince=2026-01-01T00:00:00Z&limit=2"))).json();
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("p2");
    expect(body.data).toHaveLength(2);
  });

  it("PAGINATION: updatedSince mode at the end of the walk -> hasMore false, nextCursor null", async () => {
    authorize(["stock:read"]);
    db.product.findMany.mockResolvedValue([stockRow("p1")]);

    const body = await (await stockGET(req("/api/v1/stock?updatedSince=2026-01-01T00:00:00Z&limit=5"))).json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/v1/orders
// ════════════════════════════════════════════════════════════════════════════

describe("CONTRACT POST /api/v1/orders", () => {
  it("201 envelope is exactly { data: { id, invoiceNumber, total, createdAt, replayed } }", async () => {
    authorize(["orders:create"]);
    stubOrderCreate("10");

    const res = await ordersPOST(orderReq());
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(keys(body)).toEqual(ORDER_ENVELOPE);
    expect(keys(body.data)).toEqual(ORDER_DATA);
    expect(typeof body.data.id).toBe("string");
    expect(typeof body.data.invoiceNumber).toBe("string");
    // Decimal -> number. A string total silently breaks consumer accounting.
    expect(typeof body.data.total).toBe("number");
    expect(body.data.total).toBe(39.98);
    expect(body.data.createdAt).toMatch(ISO_8601);
    expect(body.data.replayed).toBe(false);
  });

  it("a replay of the same key and body returns 200 with the SAME shape and replayed: true", async () => {
    authorize(["orders:create"]);
    db.sale.findUnique.mockResolvedValue({
      id: "sale-1",
      invoiceNumber: "INV-000007",
      total: new Prisma.Decimal("39.98"),
      createdAt: new Date("2026-09-25T09:12:03.000Z"),
      idempotencyHash: hashOrderBody(ORDER_BODY),
    });

    const res = await ordersPOST(orderReq());
    // 200 (not 201) is the documented signal that nothing was written and
    // stock was NOT decremented a second time.
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(keys(body)).toEqual(ORDER_ENVELOPE);
    expect(keys(body.data)).toEqual(ORDER_DATA);
    expect(body.data.replayed).toBe(true);
    expect(typeof body.data.total).toBe("number");
  });

  it("the order response never exposes cost, profit or internal sale columns", async () => {
    authorize(["orders:create"]);
    stubOrderCreate("10");

    const { data } = await (await ordersPOST(orderReq())).json();
    const leaks = [
      "netProfit", "fabricationPrice", "subtotal", "discount", "tax",
      "sellerId", "apiClientId", "idempotencyKey", "idempotencyHash",
    ];
    for (const leak of leaks) expect(data).not.toHaveProperty(leak);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Error envelope — one shape, every status, every endpoint
// ════════════════════════════════════════════════════════════════════════════

describe("CONTRACT error envelope", () => {
  /** Asserts the universal body shape: `{ error: { code, message, ...documented extras } }`. */
  async function expectErrorBody(res: Response, status: number, code: string, extras: string[] = []) {
    expect(res.status).toBe(status);
    // Never an HTML or empty body: an integrator calls response.json() on this.
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();

    expect(keys(body)).toEqual(ERROR_ENVELOPE);
    expect(keys(body.error)).toEqual([...ERROR_FIELDS, ...extras].sort());
    // The machine-readable half is a stable string integrators branch on.
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    return body;
  }

  /** Body shape AND the traceability header integrators quote to support. */
  async function expectErrorEnvelope(res: Response, status: number, code: string, extras: string[] = []) {
    const body = await expectErrorBody(res, status, code, extras);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    return body;
  }

  it("401 unauthorized — no Authorization header", async () => {
    await expectErrorEnvelope(await productsGET(req("/api/v1/products", { anonymous: true })), 401, "unauthorized");
  });

  it("403 insufficient_scope carries the documented extra field requiredScope", async () => {
    authorize(["stock:read"]); // key cannot read the catalogue
    const body = await expectErrorEnvelope(
      await productsGET(req("/api/v1/products")),
      403,
      "insufficient_scope",
      ["requiredScope"]
    );
    expect(body.error.requiredScope).toBe("products:read");
  });

  it("403 credential_inactive — the key is revoked", async () => {
    authorize(["products:read"], { revokedAt: new Date("2026-01-01T00:00:00Z") });
    await expectErrorEnvelope(await productsGET(req("/api/v1/products")), 403, "credential_inactive");
  });

  it("403 api_not_enabled — the store's storefront API switch is off", async () => {
    authorize(["products:read"], { store: { status: "ACTIVE", features: { storefront_api_enabled: false } } });
    await expectErrorEnvelope(await productsGET(req("/api/v1/products")), 403, "api_not_enabled");
  });

  it("400 invalid_parameter — unparseable updatedSince", async () => {
    authorize(["products:read"]);
    await expectErrorEnvelope(
      await productsGET(req("/api/v1/products?updatedSince=not-a-date")),
      400,
      "invalid_parameter"
    );
  });

  it("400 invalid_parameter — cursor combined with ids on /stock", async () => {
    authorize(["stock:read"]);
    await expectErrorEnvelope(await stockGET(req("/api/v1/stock?ids=p1&cursor=abc")), 400, "invalid_parameter");
  });

  it("400 invalid_json — order body is not JSON", async () => {
    authorize(["orders:create"]);
    await expectErrorEnvelope(await ordersPOST(orderReq("{not json")), 400, "invalid_json");
  });

  it("422 invalid_body carries the documented extra array issues: [{ path, message }]", async () => {
    authorize(["orders:create"]);
    const body = await expectErrorEnvelope(
      await ordersPOST(orderReq({ idempotencyKey: "short", items: [] })),
      422,
      "invalid_body",
      ["issues"]
    );
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
    for (const issue of body.error.issues) {
      expect(keys(issue)).toEqual(["message", "path"]);
      expect(typeof issue.path).toBe("string");
      expect(typeof issue.message).toBe("string");
    }
  });

  it("409 insufficient_stock — the anti-overselling response", async () => {
    authorize(["orders:create"]);
    stubOrderCreate("0");
    await expectErrorEnvelope(await ordersPOST(orderReq()), 409, "insufficient_stock");
  });

  it("404 product_unavailable — a productId that is not in this store or not active", async () => {
    authorize(["orders:create"]);
    stubOrderCreate("10");
    db.product.findMany.mockResolvedValue([]); // nothing matched
    await expectErrorEnvelope(await ordersPOST(orderReq()), 404, "product_unavailable");
  });

  it("404 not_found — a path with no endpoint behind it answers JSON, not HTML", async () => {
    await expectErrorEnvelope(await catchAllGET(req("/api/v1/nope", { anonymous: true })), 404, "not_found");
  });

  it("405 method_not_allowed — Allow header, JSON body, and an x-request-id", async () => {
    // The rejecters are wrapped in `apiRoute` for the same reason the handlers
    // are: a wrong-method call is what an integrator hits while wiring up their
    // first request, so it is the response that most needs a traceable id.
    const res = await productsPOST(req("/api/v1/products", { anonymous: true }));
    await expectErrorBody(res, 405, "method_not_allowed");
    expect(res.headers.get("Allow")).toBe("GET");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cross-cutting response headers
// ════════════════════════════════════════════════════════════════════════════

describe("CONTRACT response headers", () => {
  it("every success response carries x-request-id and Cache-Control: no-store", async () => {
    authorize(["products:read", "stock:read"]);
    db.product.findMany.mockResolvedValue([productRow()]);

    const products = await productsGET(req("/api/v1/products"));
    expect(products.headers.get("x-request-id")).toBeTruthy();
    expect(products.headers.get("Cache-Control")).toBe("no-store");

    const stock = await stockGET(req("/api/v1/stock?ids=p1"));
    expect(stock.headers.get("x-request-id")).toBeTruthy();
    expect(stock.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a caller-supplied x-request-id is echoed back verbatim so traces join up", async () => {
    authorize(["products:read"]);
    db.product.findMany.mockResolvedValue([productRow()]);

    const res = await productsGET(req("/api/v1/products", { headers: { "x-request-id": "trace-abc-123" } }));
    expect(res.headers.get("x-request-id")).toBe("trace-abc-123");
  });
});
