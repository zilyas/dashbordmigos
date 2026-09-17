import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateApiRequest, noStore, apiError } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 200;

/**
 * `GET /api/v1/stock` — the cheap, high-frequency endpoint. Quantities only,
 * no catalog metadata, so a storefront can poll it every few seconds to keep
 * every connected site's availability converged without re-pulling descriptions
 * and images from `/api/v1/products`.
 *
 * Two modes:
 *   ?ids=a,b,c        — exact levels for a known set (e.g. the items in a cart)
 *   ?updatedSince=ISO — everything whose stock may have moved since that instant
 *
 * `updatedSince` is served off `@@index([storeId, updatedAt])`. Poll it with the
 * `syncedAt` from your previous response, minus a few seconds of overlap: a row
 * updated in the same millisecond as your cutoff could otherwise be missed, and
 * re-reading a row is free whereas missing one means overselling.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request, "stock:read", "read");
  if (!auth.ok) return noStore(auth.response);

  try {
    const url = new URL(request.url);
    const idsRaw = url.searchParams.get("ids");
    const updatedSinceRaw = url.searchParams.get("updatedSince");

    if (!idsRaw && !updatedSinceRaw) {
      return noStore(apiError(400, "invalid_parameter", "Pass either ids or updatedSince."));
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

    const products = await prisma.product.findMany({
      where: {
        storeId: auth.context.storeId,
        status: "ACTIVE",
        ...(ids ? { id: { in: ids } } : {}),
        ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: MAX_IDS,
      select: {
        id: true,
        sku: true,
        stock: true,
        hasVariants: true,
        updatedAt: true,
        variants: { where: { isActive: true }, select: { id: true, sku: true, stock: true, updatedAt: true } },
      },
    });

    return noStore(
      NextResponse.json({
        data: products.map((p) => ({
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
        syncedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    await logServerError("app", error, { route: "GET /api/v1/stock", clientId: auth.context.clientId });
    return noStore(apiError(500, "internal_error", "Could not read stock levels."));
  }
}
