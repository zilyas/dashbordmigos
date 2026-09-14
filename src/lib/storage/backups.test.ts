import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
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

describe("R2 backup sync", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    readFileMock.mockClear();
    writeFileMock.mockClear();
    mkdirMock.mockClear();
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes to local disk only when R2 is unconfigured", async () => {
    const result = await writeBackupFile(VALID, "test content");
    expect(result).toBe(12); // "test content" byte length
    expect(writeFileMock).toHaveBeenCalledOnce();
    expect(sendMock).not.toHaveBeenCalled(); // No R2 call
  });

  it("writes to both local and R2 when R2 is configured", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";

    const result = await writeBackupFile(VALID, "test");
    expect(result).toBe(4); // "test" byte length
    expect(writeFileMock).toHaveBeenCalledOnce(); // Local write
    expect(sendMock).toHaveBeenCalledOnce(); // R2 upload
    const { input } = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(input.Key).toBe(`backups/${VALID}`);
    expect(input.Bucket).toBe("dashboard");
    expect(input.ContentType).toBe("application/json");
  });

  it("succeeds even when R2 sync fails", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";
    sendMock.mockRejectedValueOnce(new Error("R2 network error"));

    // Should not throw; local write is what counts.
    const result = await writeBackupFile(VALID, "test");
    expect(result).toBe(4);
    expect(writeFileMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce(); // Attempted
  });
});

describe("R2 backup fallback on read", () => {
  beforeEach(() => {
    sendMock.mockReset();
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to local when R2 is unconfigured and local is missing", async () => {
    await expect(readBackupFile(VALID)).rejects.toThrow("ENOENT");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("falls back to R2 when local is missing but R2 is configured", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";

    sendMock.mockResolvedValueOnce({
      Body: {
        transformToString: async () => "restored content",
      },
    });

    const result = await readBackupFile(VALID);
    expect(result).toBe("restored content");
    expect(readFileMock).toHaveBeenCalledOnce(); // Tried local first
    expect(sendMock).toHaveBeenCalledOnce(); // Then R2
  });

  it("fails when both local and R2 are missing", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";

    sendMock.mockRejectedValueOnce(new Error("NoSuchKey"));

    await expect(readBackupFile(VALID)).rejects.toThrow(/not found locally or on R2/);
    expect(sendMock).toHaveBeenCalledOnce();
  });
});
