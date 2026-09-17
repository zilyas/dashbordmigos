import { NextResponse } from "next/server";
import { authenticateApiRequest, noStore, apiError } from "@/lib/api/auth";
import { createApiOrder } from "@/lib/api/orders";
import { apiOrderSchema } from "@/lib/validations/api-order";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/orders` — a customer bought something on a storefront, so the
 * central inventory must go down.
 *
 * Contract:
 *   201 — created, stock decremented
 *   200 — replayed (same `idempotencyKey` already recorded); stock NOT touched again
 *   409 — someone else got the last unit between the storefront's stock read
 *         and this call. The storefront should refresh from /api/v1/stock.
 *
 * The 409 is the anti-overselling guarantee: the `stock >= quantity` test lives
 * inside the UPDATE (`src/lib/inventory.ts`), so under concurrent orders exactly
 * one wins and the rest are rejected — stock can never go negative.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request, "orders:create", "orders");
  if (!auth.ok) return noStore(auth.response);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(apiError(400, "invalid_json", "Request body must be valid JSON."));
  }

  const parsed = apiOrderSchema.safeParse(body);
  if (!parsed.success) {
    return noStore(
      apiError(422, "invalid_body", "Order payload failed validation.", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      })
    );
  }

  try {
    const result = await createApiOrder(auth.context, parsed.data);
    if (!result.ok) {
      return noStore(apiError(result.status, result.code, result.message));
    }
    return noStore(
      NextResponse.json(
        { data: { ...result.sale, replayed: result.replayed } },
        { status: result.replayed ? 200 : 201 }
      )
    );
  } catch (error) {
    await logServerError("app", error, {
      route: "POST /api/v1/orders",
      clientId: auth.context.clientId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return noStore(apiError(500, "internal_error", "Could not record the order. Retry with the same idempotencyKey."));
  }
}
