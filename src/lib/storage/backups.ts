import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Deliberately outside /public — unlike product images, backup files carry
// password hashes and TOTP secrets and must never be reachable by a static
// URL. Always accessed through the authenticated download route handler.
const BACKUPS_DIR = path.join(process.cwd(), "storage", "backups");

export async function writeBackupFile(filename: string, content: string): Promise<number> {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const buffer = Buffer.from(content, "utf-8");
  await writeFile(path.join(BACKUPS_DIR, filename), buffer);
  return buffer.byteLength;
}

export async function readBackupFile(filename: string): Promise<string> {
  return readFile(path.join(BACKUPS_DIR, filename), "utf-8");
}
