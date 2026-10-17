import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiRoute, authenticateApiRequest, methodNotAllowed, noStore } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";
import { variantLabelFromParts } from "@/lib/sale-math";
import { orderedAxisValues, parseAxisValues } from "@/lib/variant-axes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * `GET /api/v1/products` — catalog + live stock for the calling key's store.
 *
 * Cursor-paginated on `(updatedAt, id)` so a storefront can both walk the full
 * catalog and, by passing `updatedSince`, poll for just what changed. That is
 * the near-real-time sync path: every connected site polls this cheaply and
 * converges on the same stock numbers.
 *
 * Cost fields (`fabricationPrice`, `profit`) are never selected — they are
 * internal, gated even for in-store Sellers by `Store.allowSellerViewCost`.
 */
async function handle(request: Request, requestId: string) {
  const auth = await authenticateApiRequest(request, "products:read", "read");
  if (!auth.ok) return noStore(auth.response);

  try {
    const url = new URL(request.url);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));
    const cursor = url.searchParams.get("cursor");
    const updatedSinceRaw = url.searchParams.get("updatedSince");

    let updatedSince: Date | undefined;
    if (updatedSinceRaw) {
      const parsed = new Date(updatedSinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return noStore(apiError(400, "invalid_parameter", "updatedSince must be an ISO 8601 timestamp."));
      }
      updatedSince = parsed;
    }

    const products = await prisma.product.findMany({
      // storeId comes from the credential row, never from a query param — this
      // is what makes cross-tenant reads impossible on a hand-crafted request.
      where: {
        storeId: auth.context.storeId,
        status: "ACTIVE",
        ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        slug: true,
        description: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        hasVariants: true,
        updatedAt: true,
        category: { select: { id: true, name: true, slug: true } },
        images: { where: { variantId: null }, orderBy: { position: "asc" }, select: { url: true } },
        variants: {
          where: { isActive: true },
          select: {
            id: true,
            sku: true,
            barcode: true,
            sellingPrice: true,
            stock: true,
            imageUrl: true,
            // Naming data for `name` / `optionValues` below. A storefront
            // showed shoppers "BAC" and "Swk" because the SKU was the only
            // thing it had to put on a colour button.
            size: { select: { name: true } },
            color: { select: { name: true } },
            axisValues: true,
          },
        },
      },
    });

    // Custom axis definitions, needed to order and label axisValues. One query
    // for the whole page rather than per variant.
    const axisDefs = await prisma.variantAxisDefinition.findMany({
      where: { storeId: auth.context.storeId, isActive: true },
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { key: true, label: true },
    });

    const hasMore = products.length > limit;
    const page = hasMore ? products.slice(0, limit) : products;

    return noStore(
      NextResponse.json({
        data: page.map((p) => ({
          id: p.id,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: Number(p.sellingPrice),
          // For a variant product the parent column is stale by design (nothing
          // syncs it from the children), so report the sum of live variants.
          stock: p.hasVariants
            ? p.variants.reduce((sum, v) => sum + Number(v.stock), 0)
            : Number(p.stock),
          unit: p.unit,
          hasVariants: p.hasVariants,
          category: p.category,
          images: p.images.map((i) => i.url),
          variants: p.variants.map((v) => {
            // Built-in Size/Color first, then the store's custom axes in their
            // configured order — the same order variantLabelFromParts gives a
            // POS receipt, so a shopper and a till agree on what a variant is
            // called.
            const axes = orderedAxisValues(parseAxisValues(v.axisValues), axisDefs);
            const optionValues = [
              ...(v.size?.name ? [{ name: "Size", value: v.size.name }] : []),
              ...(v.color?.name ? [{ name: "Color", value: v.color.name }] : []),
              ...axes.map((a) => ({ name: a.label, value: a.value })),
            ];
            return {
              id: v.id,
              sku: v.sku,
              barcode: v.barcode,
              // Falls back to the SKU rather than null: a storefront always has
              // something to render on a button, which is the whole point. The
              // SKU is also what a shop with no size/colour set would have
              // typed anyway.
              name: variantLabelFromParts(optionValues.map((o) => o.value)) ?? v.sku,
              optionValues,
              price: v.sellingPrice != null ? Number(v.sellingPrice) : Number(p.sellingPrice),
              stock: Number(v.stock),
              imageUrl: v.imageUrl,
            };
          }),
          updatedAt: p.updatedAt,
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
        syncedAt: new Date().toISOString(),
        // ISO 4217 code for every price in this payload. Once per response,
        // not per price: a payload never mixes currencies, since the key is
        // pinned to one store.
        currency: auth.context.currency,
      })
    );
  } catch (error) {
    await logServerError("app", error, { requestId, route: "GET /api/v1/products", clientId: auth.context.clientId });
    return noStore(apiError(500, "internal_error", "Could not read the catalog."));
  }
}

/**
 * `apiRoute` stamps `x-request-id` on every response this file returns — the
 * success body, an auth 401/403/429, a 400, and the 500 — from one place, so a
 * future early return cannot forget it.
 */
export const GET = apiRoute(handle);

// Explicit JSON 405s. Without these exports Next answers an unsupported method
// itself with an EMPTY body, which `response.json()` throws on — an integrator
// sees a parse error instead of "wrong method". See `methodNotAllowed`.
// Wrapped in `apiRoute` too: it is the single `x-request-id` stamping point,
// and a 405 is the response an integrator is most likely to hit while wiring
// up their first call -- exactly when they need an id to quote to support.
const rejected = apiRoute(async () => noStore(methodNotAllowed("GET")));
export const POST = rejected;
export const PUT = rejected;
export const PATCH = rejected;
export const DELETE = rejected;
