/**
 * Offline POS sync: one queued sale per request.
 *
 * A fetch route rather than a Server Action, for the same reason as the
 * snapshot: `experimental.useOffline` auto-retries Server Action requests when
 * connectivity returns, and a queued sale must be replayed by OUR engine under
 * its own idempotency key. Two retry mechanisms racing over one sale is how a
 * shop ends up billing a customer twice.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiRoute, methodNotAllowed, noStore } from "@/lib/api/auth";
import { logServerError } from "@/lib/logger";
import { can } from "@/lib/rbac";
import { getSessionContext } from "@/lib/store-context";
import { verifyLeaseForSync } from "@/lib/offline/lease-server";
import { createSaleCore, type CreateSaleFailureCode } from "@/lib/sales/create-sale";
import { saleSchema } from "@/lib/validations/sale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncSchema = z.object({
  /** Till-generated, created once when "Complete sale" was pressed. */
  clientSaleId: z.uuid(),
  lease: z.string().min(1),
  /** When the cashier actually rang it up, not when it reached us. */
  createdAt: z.iso.datetime(),
  /** What went into the drawer. See the price-override note below. */
  expectedTotal: z.number().nonnegative(),
  sale: saleSchema,
});

/**
 * Which failures a till should retry, and which need a human.
 *
 * This mapping is the whole contract with the sync engine, and both directions
 * are costly to get wrong: a terminal error marked retryable spins the queue
 * forever, and a transient error marked terminal throws away a sale the shop
 * has already taken cash for.
 *
 *   409 idempotency_conflict  - same uuid, different basket. Never retry: the
 *                               two baskets cannot both be right, a human must
 *                               look.
 *   409 insufficient_stock    - someone else sold it while the till was dark.
 *   404 product_unavailable   - product deleted or archived since.
 *   422 price_changed         - the catalogue moved too far from what was
 *                               charged. Carries serverTotal so the UI can
 *                               offer "sync at current prices".
 *   403 store_inactive        - account suspended. Stop the queue entirely.
 *   503 invoice_contention    - RETRYABLE. Pure contention on the invoice
 *                               sequence, nothing is wrong with the sale.
 *   500 unexpected            - RETRYABLE. Leave it pending.
 *
 * Everything 4xx here is terminal for that sale; 5xx means try again later.
 * That single rule is what the client keys off, so keep new codes consistent
 * with it rather than adding a separate retryable flag.
 */
const STATUS_BY_CODE: Record<CreateSaleFailureCode, number> = {
  invalid_input: 422,
  store_not_found: 404,
  store_inactive: 403,
  product_unavailable: 404,
  product_not_sellable: 422,
  invalid_quantity: 422,
  variant_required: 422,
  variant_unavailable: 404,
  insufficient_stock: 409,
  insufficient_expiry_stock: 409,
  // Transient: the row moved mid-transaction and a replay may well succeed.
  stock_changed: 503,
  idempotency_conflict: 409,
  price_changed: 422,
  invoice_contention: 503,
};

/** Lease rejections are all terminal — a till cannot fix any of them by waiting. */
const LEASE_STATUS = 403;

async function handle(request: Request, requestId: string): Promise<NextResponse> {
  let clientSaleId: string | undefined;
  try {
    const context = await getSessionContext();
    if (!context) {
      // 401 rather than 403: the client must stop the queue and ask the
      // cashier to sign in, not retry into the same wall.
      return noStore(apiError(401, "unauthorized", "Sign in to sync offline sales."));
    }
    const { storeId, userId, role } = context;
    if (!storeId) {
      return noStore(apiError(403, "no_store", "This account is not attached to a store."));
    }
    if (!can(role, "sale.create")) {
      return noStore(apiError(403, "forbidden", "You cannot record sales."));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore(apiError(400, "invalid_json", "Body must be valid JSON."));
    }

    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) {
      return noStore(
        apiError(422, "invalid_body", "The queued sale is not in the expected shape.", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        })
      );
    }
    clientSaleId = parsed.data.clientSaleId;
    const saleCreatedAt = new Date(parsed.data.createdAt);

    // THE enforcement point. The client verifies its own lease too, but that
    // check lives in IndexedDB next to code the shop's own staff can edit, so
    // it is a convenience. This is the boundary that actually holds, and it
    // runs before anything is recorded.
    const verdict = await verifyLeaseForSync(parsed.data.lease, {
      userId,
      storeId,
      saleCreatedAt,
    });
    if (!verdict.accepted) {
      return noStore(
        apiError(LEASE_STATUS, `lease_${verdict.reason}`, leaseMessage(verdict.reason), {
          ...(verdict.expiresAt ? { leaseExpiredAt: verdict.expiresAt.toISOString() } : {}),
        })
      );
    }

    const result = await createSaleCore({ userId, role, storeId }, parsed.data.sale, {
      createdAt: saleCreatedAt,
      clientSaleId: parsed.data.clientSaleId,
      expectedTotal: parsed.data.expectedTotal,
      // Gates the price override: the drawer holds what the cashier charged,
      // so the books must say that, not today's catalogue price.
      offline: true,
    });

    if (!result.ok) {
      return noStore(
        apiError(STATUS_BY_CODE[result.code], result.code, result.message, {
          ...(result.serverTotal !== undefined ? { serverTotal: result.serverTotal } : {}),
        })
      );
    }

    return noStore(
      NextResponse.json({
        ok: true,
        saleId: result.saleId,
        invoiceNumber: result.invoiceNumber,
        // True when an earlier attempt already landed this sale. The till
        // treats it exactly like a fresh success and drops the local record.
        replayed: result.replayed,
        total: result.total,
      })
    );
  } catch (error) {
    await logServerError("app", error, {
      requestId,
      route: "POST /api/pos/offline/sales",
      clientSaleId,
    });
    // 5xx on purpose: the till keeps the sale pending and retries.
    return noStore(apiError(500, "internal_error", "Could not record the sale. Retry later."));
  }
}

function leaseMessage(reason: string): string {
  switch (reason) {
    case "offline_disabled":
      return "Offline selling is not enabled for this deployment.";
    case "expired":
      return "The offline lease had expired when this sale was made.";
    case "sale_outside_lease":
      return "This sale was made outside the offline lease window.";
    case "sale_in_future":
      return "This sale is dated in the future; check the device clock.";
    case "wrong_user":
      return "This lease belongs to a different user or store.";
    default:
      // bad_signature / malformed / key_unusable deliberately share one vague
      // message: distinguishing them tells a tamperer which half to fix.
      return "The offline lease is not valid.";
  }
}

export const POST = apiRoute(handle);

const rejected = apiRoute(async () => noStore(methodNotAllowed("POST")));
export const GET = rejected;
export const PUT = rejected;
export const PATCH = rejected;
export const DELETE = rejected;
