import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/audit";
import { logServerError } from "@/lib/logger";
import { createBackupPayload } from "@/lib/backup";
import { deleteBackupFile, writeBackupFile } from "@/lib/storage/backups";

/**
 * Shared backup execution, used by both the Super Admin action
 * (`src/actions/backup.ts`) and the scheduled route
 * (`src/app/api/cron/backup/route.ts`). Auth/permission is the caller's job —
 * this only runs the work and records the outcome.
 *
 * A FAILED record is written on error so a silently broken nightly job is
 * visible in the backup history instead of just absent.
 */
export async function runBackup(actorUserId: string): Promise<
  { ok: true; id: string; filename: string; sizeBytes: number } | { ok: false; error: string }
> {
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;

  try {
    const payload = await createBackupPayload();
    const sizeBytes = await writeBackupFile(filename, JSON.stringify(payload, null, 2));

    const record = await prisma.backupRecord.create({
      data: { filename, sizeBytes, createdById: actorUserId, status: "COMPLETED" },
    });

    await logActivity({
      storeId: null,
      userId: actorUserId,
      action: "backup.created",
      entity: "BackupRecord",
      entityId: record.id,
      metadata: { filename, sizeBytes },
    });

    return { ok: true, id: record.id, filename, sizeBytes };
  } catch (error) {
    await logServerError("app", error, { action: "backup.created", filename, userId: actorUserId });

    const record = await prisma.backupRecord.create({
      data: { filename, sizeBytes: 0, createdById: actorUserId, status: "FAILED" },
    });
    await logActivity({
      storeId: null,
      userId: actorUserId,
      action: "backup.failed",
      entity: "BackupRecord",
      entityId: record.id,
    });

    return { ok: false, error: "Backup failed. Check server logs for details." };
  }
}

/**
 * Deletes COMPLETED backups older than `retentionDays`, file first then record
 * — a record whose file is already gone is worse than an orphan file, since
 * the UI would offer a download that 404s. FAILED records are left alone: they
 * are the audit trail of a broken job and carry no file.
 *
 * Local disk only decides success; the R2 copy is best-effort (an R2 bucket
 * lifecycle rule is the durable answer there — see .env.example).
 */
export async function pruneBackups(retentionDays: number): Promise<{ deleted: number }> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { deleted: 0 };

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const stale = await prisma.backupRecord.findMany({
    where: { createdAt: { lt: cutoff }, status: "COMPLETED" },
    select: { id: true, filename: true },
  });

  let deleted = 0;
  for (const record of stale) {
    try {
      await deleteBackupFile(record.filename);
      await prisma.backupRecord.delete({ where: { id: record.id } });
      deleted += 1;
    } catch (error) {
      await logServerError("system", error, { action: "backup.prune", filename: record.filename });
    }
  }
  return { deleted };
}
