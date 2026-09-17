import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateApiRequest, noStore, apiError } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";

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
export async function GET(request: Request) {
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
          select: { id: true, sku: true, barcode: true, sellingPrice: true, stock: true, imageUrl: true },
        },
      },
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
          variants: p.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            price: v.sellingPrice != null ? Number(v.sellingPrice) : Number(p.sellingPrice),
            stock: Number(v.stock),
            imageUrl: v.imageUrl,
          })),
          updatedAt: p.updatedAt,
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
        syncedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    await logServerError("app", error, { route: "GET /api/v1/products", clientId: auth.context.clientId });
    return noStore(apiError(500, "internal_error", "Could not read the catalog."));
  }
}
