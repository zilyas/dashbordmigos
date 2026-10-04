/**
 * Catch-all for any /api/* path that doesn't match a real route file.
 *
 * Without this, an unmatched path under /api falls through to Next's default
 * "no route matched" response, which is HTML. A machine client calling
 * `response.json()` on that throws — the integrator sees a parse error
 * instead of a diagnosable "no such endpoint". Next always prefers a more
 * specific, literal route file over this catch-all, so a real endpoint (e.g.
 * `/api/v1/products`) is never shadowed by it; this only fires for paths that
 * genuinely have nothing behind them. It reuses `apiError()` from
 * `src/lib/api/auth.ts` so the body is byte-for-byte the same envelope every
 * real v1 route already returns.
 *
 * A 405 on an EXISTING route is a separate problem this file structurally
 * cannot reach — Next matches the literal route file before it ever considers
 * a sibling catch-all. Each v1 route closes that itself by exporting
 * `methodNotAllowed()` for the methods it rejects.
 */
import { apiError, apiRoute, noStore } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `apiRoute` supplies the `x-request-id` — echoed from the caller when they
// sent a valid one, minted otherwise — so a client hitting a wrong URL can
// still quote something in a support ticket.
const notFound = apiRoute(async () => noStore(apiError(404, "not_found", "No such endpoint.")));

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
