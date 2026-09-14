import { describe, it, expect, vi } from "vitest";

const { writeFileMock, readFileMock, mkdirMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn(async () => undefined),
  readFileMock: vi.fn(async () => "{}"),
  mkdirMock: vi.fn(async () => undefined),
}));

vi.mock("fs/promises", () => ({
  writeFile: writeFileMock,
  readFile: readFileMock,
  mkdir: mkdirMock,
}));

import { readBackupFile, writeBackupFile } from "@/lib/storage/backups";

// The exact shape createBackup() produces in src/actions/backup.ts.
const VALID = "backup-2026-09-14T10-30-00-000Z-1a2b3c4d.json";

describe("backup filename validation", () => {
  it("accepts a filename this module produced", async () => {
    await expect(writeBackupFile(VALID, "{}")).resolves.toBeTypeOf("number");
    await expect(readBackupFile(VALID)).resolves.toBe("{}");
  });

  it.each([
    ["parent traversal", "../../../.env"],
    ["traversal with valid suffix", "../../backup-2026-01-01T00-00-00-000Z-deadbeef.json"],
    ["absolute path", "/etc/passwd"],
    ["wrong extension", "backup-2026-09-14T10-30-00-000Z-1a2b3c4d.env"],
    ["missing prefix", "2026-09-14T10-30-00-000Z-1a2b3c4d.json"],
    ["non-hex suffix", "backup-2026-09-14T10-30-00-000Z-zzzzzzzz.json"],
    ["empty", ""],
  ])("rejects %s", async (_label, filename) => {
    await expect(writeBackupFile(filename, "{}")).rejects.toThrow("Invalid backup filename.");
    await expect(readBackupFile(filename)).rejects.toThrow("Invalid backup filename.");
  });
});
