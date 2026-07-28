"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/audit";
import { createBackupPayload, isValidBackupPayload, restoreBackupPayload } from "@/lib/backup";
import { writeBackupFile } from "@/lib/storage/backups";

const RESTORE_CONFIRMATION_TEXT = "RESTORE";

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "backup.manage")) {
    throw new Error("Not authorized");
  }
  return session;
}

export async function createBackup() {
  const session = await requireSuperAdmin();

  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;

  try {
    const payload = await createBackupPayload();
    const content = JSON.stringify(payload, null, 2);
    const sizeBytes = await writeBackupFile(filename, content);

    const record = await prisma.backupRecord.create({
      data: {
        filename,
        sizeBytes,
        createdById: session.user.id,
        status: "COMPLETED",
      },
    });

    await logActivity({
      storeId: null,
      userId: session.user.id,
      action: "backup.created",
      entity: "BackupRecord",
      entityId: record.id,
      metadata: { filename, sizeBytes },
    });

    revalidatePath("/backups");
    return { success: true as const, id: record.id };
  } catch {
    const record = await prisma.backupRecord.create({
      data: { filename, sizeBytes: 0, createdById: session.user.id, status: "FAILED" },
    });
    await logActivity({
      storeId: null,
      userId: session.user.id,
      action: "backup.failed",
      entity: "BackupRecord",
      entityId: record.id,
    });
    revalidatePath("/backups");
    return { error: "Backup failed. Check server logs for details." };
  }
}

export async function restoreBackup(fileContent: string, confirmText: string) {
  const session = await requireSuperAdmin();

  if (confirmText !== RESTORE_CONFIRMATION_TEXT) {
    return { error: `Type "${RESTORE_CONFIRMATION_TEXT}" to confirm.` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fileContent);
  } catch {
    return { error: "That file is not valid JSON." };
  }

  if (!isValidBackupPayload(payload)) {
    return { error: "That file is not a recognized backup." };
  }

  try {
    await restoreBackupPayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed.";
    return { error: `Restore failed: ${message}` };
  }

  // Every table — including ActivityLog and the acting user's own row —
  // was just replaced by the backup's contents. If this admin account
  // didn't exist yet at backup time, it (and this audit entry) won't
  // survive the restore; that's expected for a full rewind, so this is
  // best-effort and must never turn a successful restore into a reported
  // failure.
  try {
    await logActivity({
      storeId: null,
      userId: session.user.id,
      action: "backup.restored",
      entity: "BackupRecord",
      metadata: { backupCreatedAt: payload.createdAt },
    });
  } catch {
    // acting user may no longer exist post-restore — see comment above.
  }

  revalidatePath("/", "layout");
  return { success: true as const };
}
