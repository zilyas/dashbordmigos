import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { scopedLogger } from "@/lib/logger";
import { decrypt, encrypt, getEncryptionKey } from "@/lib/security/encryption";

const systemLogger = scopedLogger("system");

// Deliberately outside /public — unlike product images, backup files carry
// password hashes and TOTP secrets and must never be reachable by a static
// URL. Always accessed through the authenticated download route handler.
const BACKUPS_DIR = path.join(process.cwd(), "storage", "backups");
const R2_BACKUPS_PREFIX = "backups";

// Matches exactly what createBackup() generates:
// backup-2026-09-14T10-30-00-000Z-1a2b3c4d.json
const BACKUP_FILENAME = /^backup-[0-9TZ-]+-[0-9a-f]{8}\.json$/;

/**
 * Rejects anything that is not a filename this module itself produced. The
 * value reaches us from the database rather than from a request, but a single
 * bad write would otherwise turn `path.join` into arbitrary-path read/write
 * (`../../.env`), so the format is re-checked at the filesystem boundary.
 */
function resolveBackupPath(filename: string): string {
  if (!BACKUP_FILENAME.test(filename)) {
    throw new Error("Invalid backup filename.");
  }
  return path.join(BACKUPS_DIR, filename);
}

function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

function getEndpoint(): string {
  return (
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  );
}

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: getEndpoint(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return cachedClient;
}

/**
 * Write backup to local disk and optionally to R2 if configured.
 * R2 upload failures are logged but do NOT fail the backup — degraded
 * mode is acceptable so long as the local copy succeeds. However, a
 * backup that cannot write to either local or R2 (when R2 is the only
 * option) will be reported as failed.
 * Returns the byte count of what was written locally (the source of truth
 * for the backup record).
 *
 * Content is AES-256-GCM encrypted before it touches disk or R2 — a backup
 * is a full DB dump (password hashes, TOTP secrets, recovery code hashes),
 * so it must never sit anywhere as plain JSON.
 */
export async function writeBackupFile(filename: string, content: string): Promise<number> {
  if (!BACKUP_FILENAME.test(filename)) {
    throw new Error("Invalid backup filename.");
  }

  const target = resolveBackupPath(filename);
  await mkdir(BACKUPS_DIR, { recursive: true });
  const buffer = Buffer.from(encrypt(content, getEncryptionKey()), "utf-8");
  await writeFile(target, buffer);

  // Sync to R2 if configured. Log failures but do not fail the entire backup.
  if (isR2Configured()) {
    try {
      const r2Key = `${R2_BACKUPS_PREFIX}/${filename}`;
      await getClient().send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET as string,
          Key: r2Key,
          Body: buffer,
          ContentType: "application/json",
        })
      );
      systemLogger.info({ filename, sizeBytes: buffer.byteLength }, "backup synced to R2");
    } catch (error) {
      // R2 upload failed. Log it loudly but allow the local backup to stand.
      // The backup is still recorded in the database; on restore, if the
      // local file is missing, we'll try R2 (and will fail then, visibly).
      systemLogger.error(
        { err: error, filename },
        "R2 backup sync failed: using local backup only (disaster recovery downgraded)"
      );
    }
  }

  return buffer.byteLength;
}

/**
 * Delete a backup from local disk and, when configured, from R2. Missing files
 * are not an error (`rm` with `force`) — retention pruning must stay idempotent
 * so a partially-completed previous run can simply be repeated. An R2 delete
 * failure is logged, not thrown, for the same reason: the local copy (the
 * source of truth for the record) is already gone.
 */
export async function deleteBackupFile(filename: string): Promise<void> {
  const target = resolveBackupPath(filename);
  await rm(target, { force: true });

  if (isR2Configured()) {
    try {
      await getClient().send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET as string,
          Key: `${R2_BACKUPS_PREFIX}/${filename}`,
        })
      );
    } catch (error) {
      systemLogger.error({ err: error, filename }, "R2 backup delete failed: object may be orphaned");
    }
  }
}

/**
 * Read backup from local disk, falling back to R2 if the local file is missing.
 * This enables restore on a fresh host (or after storage wipe) when R2 is
 * configured. If both local and R2 are missing (or R2 is unconfigured), error.
 *
 * Content is decrypted after reading — mirrors the encrypt-on-write in
 * writeBackupFile(), same ENCRYPTION_KEY.
 */
export async function readBackupFile(filename: string): Promise<string> {
  if (!BACKUP_FILENAME.test(filename)) {
    throw new Error("Invalid backup filename.");
  }

  const localPath = resolveBackupPath(filename);
  const key = getEncryptionKey();

  // Try local first.
  try {
    return decrypt(await readFile(localPath, "utf-8"), key);
  } catch (localError) {
    // Local file missing. If R2 is configured, try there.
    if (!isR2Configured()) {
      throw localError; // Neither available; fail with the original error.
    }

    try {
      const r2Key = `${R2_BACKUPS_PREFIX}/${filename}`;
      const response = await getClient().send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET as string,
          Key: r2Key,
        })
      );

      if (!response.Body) {
        throw new Error("R2 object has no body");
      }

      const buffer = decrypt(await response.Body.transformToString("utf-8"), key);
      systemLogger.info({ filename }, "backup restored from R2 (local copy missing)");
      return buffer;
    } catch (r2Error) {
      systemLogger.error(
        { err: r2Error, filename },
        "backup not found on R2; cannot restore"
      );
      throw new Error(
        `Backup file not found locally or on R2: ${filename}`
      );
    }
  }
}
