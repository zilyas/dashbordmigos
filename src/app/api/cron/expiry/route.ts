import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runExpirySweep } from "@/lib/expiry-sweep";
import { logServerError } from "@/lib/logger";

// Node runtime: the sweep uses Prisma (Node-only driver) and crypto.
export const runtime = "nodejs";
// Never cache — this is a mutating, on-demand daily job.
export const dynamic = "force-dynamic";

/** Constant-time string comparison that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Daily expiry sweep endpoint. Deployment infrastructure must POST here once a
 * day (e.g. a platform cron / scheduled job) with `Authorization: Bearer <secret>`
 * where <secret> is `EXPIRY_CRON_SECRET`. Safe to retry — notifications dedupe.
 * Returns only aggregate counts, never catalog data.
 */
export async function POST(request: Request) {
  const secret = process.env.EXPIRY_CRON_SECRET;
  if (!secret) {
    // Feature not configured for this deployment.
    return NextResponse.json({ error: "Expiry cron is not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runExpirySweep();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    await logServerError("system", error, { route: "/api/cron/expiry" });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
