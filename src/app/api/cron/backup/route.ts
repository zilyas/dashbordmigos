import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { pruneBackups, runBackup } from "@/lib/backup-run";
import { logServerError } from "@/lib/logger";

// Node runtime: the backup uses Prisma (Node-only driver), fs and crypto.
export const runtime = "nodejs";
// Never cache — this is a mutating, on-demand scheduled job.
export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_DAYS = 30;

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
 * Scheduled full-database backup. Deployment infrastructure must POST here on
 * a schedule (typically daily) with `Authorization: Bearer <secret>` where
 * <secret> is `BACKUP_CRON_SECRET`. Returns aggregate counts only, never data.
 *
 * Attribution: the backup record needs a `createdById`, and a cron call has no
 * session, so the oldest SUPER_ADMIN is used as the system actor — the same
 * account that would be entitled to run this by hand.
 */
export async function POST(request: Request) {
  const secret = process.env.BACKUP_CRON_SECRET;
  if (!secret) {
    // Feature not configured for this deployment.
    return NextResponse.json({ error: "Backup cron is not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const actor = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!actor) {
      return NextResponse.json({ error: "No active super admin to attribute the backup to." }, { status: 503 });
    }

    const result = await runBackup(actor.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Prune only after a successful backup, so a run of failures can never
    // erode the retention window down to nothing.
    const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
    const { deleted } = await pruneBackups(retentionDays);

    return NextResponse.json({ ok: true, sizeBytes: result.sizeBytes, pruned: deleted });
  } catch (error) {
    await logServerError("system", error, { route: "/api/cron/backup" });
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}
