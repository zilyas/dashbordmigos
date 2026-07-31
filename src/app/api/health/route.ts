import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scopedLogger } from "@/lib/logger";

const systemLogger = scopedLogger("system");

/**
 * Unauthenticated liveness/readiness probe for Coolify. Deliberately does
 * nothing beyond a trivial DB ping — no row counts or other data that would
 * leak platform size to an unauthenticated caller.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    systemLogger.error({ err: error }, "health check failed: database unreachable");
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
