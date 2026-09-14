"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";
import { logServerError } from "@/lib/logger";
import { isValidBackupPayload, restoreBackupPayload } from "@/lib/backup";
import { runBackup } from "@/lib/backup-run";

const RESTORE_CONFIRMATION_TEXT = "RESTORE";

const requireSuperAdmin = requirePermission("backup.manage");

export async function createBackup() {
  const session = await requireSuperAdmin();

  // Work, records and failure handling live in runBackup — shared verbatim
  // with the scheduled route (src/app/api/cron/backup/route.ts).
  const result = await runBackup(session.user.id);
  revalidatePath("/backups");

  return result.ok ? { success: true as const, id: result.id } : { error: result.error };
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
    await logServerError("app", error, { action: "backup.restored", userId: session.user.id });
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
