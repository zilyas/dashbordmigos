/**
 * Offline POS snapshot: everything a till needs cached to keep selling with no
 * network, fetched while it still has one.
 *
 * Session-authenticated, NOT an ApiClient bearer key. A till is a signed-in
 * human at a known store; a storefront key is a machine for an external site.
 * They get different data and different trust, so they get different routes.
 *
 * A fetch route rather than a Server Action, deliberately.
 * `experimental.useOffline` is on in next.config.ts, and per
 * node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useOffline.md
 * it automatically retries Server Action requests once connectivity returns.
 * For a queued sale that is exactly wrong: our sync engine replays it under its
 * own idempotency key, and Next's retry layer replaying the same action would
 * put two mechanisms in charge of one sale. Routes opt out of that entirely.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiRoute, methodNotAllowed, noStore } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";
import { getSessionContext } from "@/lib/store-context";
import { getStoreSettings } from "@/lib/queries/settings";
import { getSales } from "@/lib/queries/sales";
import {
  getOfflineLeasePublicKeyBase64,
  issueLease,
  offlineLeaseEnabled,
} from "@/lib/offline/lease-server";
import { parseAxisValues, axisValueList } from "@/lib/variant-axes";
import { variantLabelFromParts } from "@/lib/sale-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The till only ever shows the last 10; downloading more is wasted cache. */
const RECENT_SALES_LIMIT = 10;

async function handle(_request: Request, requestId: string): Promise<NextResponse> {
  try {
    const context = await getSessionContext();
    if (!context) {
      return noStore(apiError(401, "unauthorized", "Sign in to use the offline till."));
    }
    const { storeId, userId, role } = context;
    if (!storeId) {
      // SUPER_ADMIN has no store, so there is no till and no catalogue to cache.
      return noStore(apiError(403, "no_store", "This account is not attached to a store."));
    }

    const [settings, axisDefs, products, recentSales, user] = await Promise.all([
      getStoreSettings(storeId),
      prisma.variantAxisDefinition.findMany({
        where: { storeId, isActive: true },
        orderBy: [{ position: "asc" }, { label: "asc" }],
        select: { key: true, label: true },
      }),
      prisma.product.findMany({
        where: { storeId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        // Hand-written select rather than reusing getPOSProducts: that query
        // returns `fabricationPrice` and `image`, and neither may be cached on
        // a shop-floor device. Cost price in a till's IndexedDB is a margin
        // leak to anyone who opens devtools, and images would balloon the
        // cache for data the offline UI deliberately renders as text.
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          unit: true,
          allowDecimalQuantity: true,
          sellingPrice: true,
          stock: true,
          hasVariants: true,
          trackBatch: true,
          variants: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              sku: true,
              barcode: true,
              sellingPrice: true,
              stock: true,
              axisValues: true,
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      }),
      // Same scoping as the Sales page, via the same function: a SELLER sees
      // only their own sales. Reimplementing that filter here is how the two
      // surfaces drift until one leaks a colleague's takings.
      getSales({ role, userId, storeId }),
      // Receipt line. Cached with the rest because the offline till has no way
      // to look a name up once the network is gone.
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    // A lease is only issued when the keys are configured. Unset keys mean
    // offline mode is off, not that this route fails — the online POS must be
    // completely unaffected by a deployment that never set them up.
    const issued = offlineLeaseEnabled() ? await issueLease(userId, storeId, role) : null;
    const publicKey = await getOfflineLeasePublicKeyBase64();

    return noStore(
      NextResponse.json({
        // Delivered here rather than as a NEXT_PUBLIC_* build variable: baking
        // it into the bundle would make key rotation a full rebuild and image
        // prune (see c61cb20, which removed build-time secrets on purpose).
        // A public key is not a secret, so serving it per request costs nothing.
        publicKey,
        lease: issued?.ok ? issued.token : null,
        leaseDenied: issued && !issued.ok ? issued.reason : null,
        fetchedAt: new Date().toISOString(),
        config: {
          userId,
          userName: user?.name ?? null,
          role,
          storeId,
          storeName: settings.storeName,
          currency: settings.currency,
          taxRate: settings.taxRate,
          unitsEnabled: settings.features.units_enabled,
        },
        products: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          unit: p.unit ?? "piece",
          allowDecimalQuantity: p.allowDecimalQuantity,
          price: Number(p.sellingPrice),
          // Live variant sum, matching /api/v1/products. The parent column is
          // never written for a variant product (see 2b29cc5), so reading it
          // here would cache a figure that is wrong the moment a variant sells.
          stock: p.hasVariants
            ? p.variants.reduce((sum, v) => sum + Number(v.stock), 0)
            : Number(p.stock),
          hasVariants: p.hasVariants,
          // Batch-tracked products need FEFO allocation, which the offline till
          // cannot do without the batch rows. Flagged so the UI can refuse them
          // up front rather than failing at sync, after the goods have left.
          trackBatch: p.trackBatch,
          variants: p.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            label:
              variantLabelFromParts([
                v.size?.name,
                v.color?.name,
                ...axisValueList(parseAxisValues(v.axisValues), axisDefs),
              ]) ?? v.sku,
            price: v.sellingPrice != null ? Number(v.sellingPrice) : Number(p.sellingPrice),
            stock: Number(v.stock),
          })),
        })),
        recentSales: recentSales.slice(0, RECENT_SALES_LIMIT).map((s) => ({
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          total: s.total,
          createdAt: s.createdAt,
          customerName: s.customerName,
          paymentMethod: s.paymentMethod,
          itemCount: s.itemCount,
        })),
      })
    );
  } catch (error) {
    await logServerError("app", error, { requestId, route: "GET /api/pos/offline" });
    return noStore(apiError(500, "internal_error", "Could not build the offline snapshot."));
  }
}

export const GET = apiRoute(handle);

// Wrapped in `apiRoute` like the handler: 441c1fe fixed exactly this omission
// on the v1 routes, where a 405 was the one response with no x-request-id.
const rejected = apiRoute(async () => noStore(methodNotAllowed("GET")));
export const POST = rejected;
export const PUT = rejected;
export const PATCH = rejected;
export const DELETE = rejected;
