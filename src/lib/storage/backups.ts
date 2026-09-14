import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Deliberately outside /public — unlike product images, backup files carry
// password hashes and TOTP secrets and must never be reachable by a static
// URL. Always accessed through the authenticated download route handler.
const BACKUPS_DIR = path.join(process.cwd(), "storage", "backups");

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

export async function writeBackupFile(filename: string, content: string): Promise<number> {
  const target = resolveBackupPath(filename);
  await mkdir(BACKUPS_DIR, { recursive: true });
  const buffer = Buffer.from(content, "utf-8");
  await writeFile(target, buffer);
  return buffer.byteLength;
}

export async function readBackupFile(filename: string): Promise<string> {
  return readFile(resolveBackupPath(filename), "utf-8");
}
