import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateApiRequest, noStore, apiError } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 200;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * `GET /api/v1/stock` — the cheap, high-frequency endpoint. Quantities only,
 * no catalog metadata, so a storefront can poll it every few seconds to keep
 * every connected site's availability converged without re-pulling descriptions
 * and images from `/api/v1/products`.
 *
 * Two modes:
 *   ?ids=a,b,c        — exact levels for a known set (e.g. the items in a cart).
 *                       Bounded by the 1..200 ids validation itself, so it is
 *                       not cursor-paginated; `cursor` is rejected alongside `ids`.
 *   ?updatedSince=ISO — everything whose stock may have moved since that instant.
 *                       Cursor-paginated: pass `limit` (default 50, max 200) and
 *                       `cursor` (the last row's product id from `nextCursor`).
 *                       Poll: follow `nextCursor` while `hasMore` is true, then
 *                       start the next round from the previous response's
 *                       `syncedAt` (minus a few seconds of overlap — re-reading
 *                       a row is free, missing one means overselling).
 *
 * `updatedSince` is served off `@@index([storeId, updatedAt])`. Order is
 * `(updatedAt asc, id asc)` — the `id` tiebreak is required for cursor
 * correctness: without it, rows sharing an `updatedAt` millisecond could be
 * split across pages in an order Postgres doesn't guarantee, silently
 * skipping or duplicating a row at the page boundary.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request, "stock:read", "read");
  if (!auth.ok) return noStore(auth.response);

  try {
    const url = new URL(request.url);
    const idsRaw = url.searchParams.get("ids");
    const updatedSinceRaw = url.searchParams.get("updatedSince");
    const cursor = url.searchParams.get("cursor");

    if (!idsRaw && !updatedSinceRaw) {
      return noStore(apiError(400, "invalid_parameter", "Pass either ids or updatedSince."));
    }

    if (idsRaw && cursor) {
      return noStore(apiError(400, "invalid_parameter", "cursor is not supported with ids; ids is already bounded."));
    }

    let ids: string[] | undefined;
    if (idsRaw) {
      ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0 || ids.length > MAX_IDS) {
        return noStore(apiError(400, "invalid_parameter", `ids must contain between 1 and ${MAX_IDS} product ids.`));
      }
    }

    let updatedSince: Date | undefined;
    if (updatedSinceRaw) {
      const parsed = new Date(updatedSinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return noStore(apiError(400, "invalid_parameter", "updatedSince must be an ISO 8601 timestamp."));
      }
      updatedSince = parsed;
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

    const products = await prisma.product.findMany({
      where: {
        storeId: auth.context.storeId,
        status: "ACTIVE",
        ...(ids ? { id: { in: ids } } : {}),
        ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      // `ids` mode is already bounded, so it takes the full set in one page.
      // `updatedSince` mode probes one extra row to detect `hasMore`.
      take: ids ? MAX_IDS : limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        sku: true,
        stock: true,
        hasVariants: true,
        updatedAt: true,
        variants: { where: { isActive: true }, select: { id: true, sku: true, stock: true, updatedAt: true } },
      },
    });

    const hasMore = !ids && products.length > limit;
    const page = hasMore ? products.slice(0, limit) : products;

    return noStore(
      NextResponse.json({
        data: page.map((p) => ({
          productId: p.id,
          sku: p.sku,
          available: p.hasVariants
            ? p.variants.reduce((sum, v) => sum + Number(v.stock), 0)
            : Number(p.stock),
          variants: p.variants.map((v) => ({
            variantId: v.id,
            sku: v.sku,
            available: Number(v.stock),
            updatedAt: v.updatedAt,
          })),
          updatedAt: p.updatedAt,
        })),
        hasMore,
        nextCursor: hasMore ? page[page.length - 1].id : null,
        syncedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    await logServerError("app", error, { route: "GET /api/v1/stock", clientId: auth.context.clientId });
    return noStore(apiError(500, "internal_error", "Could not read stock levels."));
  }
}
