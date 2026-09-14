import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { encrypt, getEncryptionKey } from "@/lib/security/encryption";

const { writeFileMock, readFileMock, mkdirMock, rmMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn(async () => undefined),
  readFileMock: vi.fn(async () => ""),
  mkdirMock: vi.fn(async () => undefined),
  rmMock: vi.fn(async (_path: string, _opts?: { force?: boolean }) => undefined),
}));

vi.mock("fs/promises", () => ({
  writeFile: writeFileMock,
  readFile: readFileMock,
  mkdir: mkdirMock,
  rm: rmMock,
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
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { deleteBackupFile, readBackupFile, writeBackupFile } from "@/lib/storage/backups";

const VALID = "backup-2026-09-14T10-30-00-000Z-1a2b3c4d.json";

beforeEach(() => {
  const key = randomBytes(32).toString("base64");
  process.env.ENCRYPTION_KEY = key;
  const ek = getEncryptionKey();
  // Mock reads encrypted data that matches the current key.
  readFileMock.mockImplementation(async () => encrypt("{}", ek));
  writeFileMock.mockImplementation(async () => undefined);
  mkdirMock.mockImplementation(async () => undefined);
  rmMock.mockImplementation(async () => undefined);
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  vi.clearAllMocks();
});

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
    await expect(deleteBackupFile(filename)).rejects.toThrow("Invalid backup filename.");
  });
});

describe("R2 backup sync", () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
  });

  it("writes to local disk only when R2 is unconfigured", async () => {
    const result = await writeBackupFile(VALID, "test content");
    const ek = getEncryptionKey();
    const encryptedBuffer = Buffer.from(encrypt("test content", ek), "utf-8");
    expect(result).toBe(encryptedBuffer.byteLength);
    expect(writeFileMock).toHaveBeenCalledOnce();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("writes to both local and R2 when R2 is configured", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";

    const result = await writeBackupFile(VALID, "test");
    const ek = getEncryptionKey();
    const encryptedBuffer = Buffer.from(encrypt("test", ek), "utf-8");
    expect(result).toBe(encryptedBuffer.byteLength);
    expect(writeFileMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
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

    const result = await writeBackupFile(VALID, "test");
    const ek = getEncryptionKey();
    const encryptedBuffer = Buffer.from(encrypt("test", ek), "utf-8");
    expect(result).toBe(encryptedBuffer.byteLength);
    expect(writeFileMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
  });
});

describe("R2 backup fallback on read", () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    sendMock.mockReset();
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

    const ek = getEncryptionKey();
    const encryptedR2Content = encrypt("restored content", ek);
    sendMock.mockResolvedValueOnce({
      Body: {
        transformToString: async () => encryptedR2Content,
      },
    });

    const result = await readBackupFile(VALID);
    expect(result).toBe("restored content");
    expect(readFileMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
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

describe("deleteBackupFile", () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
  });

  it("removes the local file and skips R2 when unconfigured", async () => {
    await deleteBackupFile(VALID);
    expect(rmMock).toHaveBeenCalledOnce();
    expect(rmMock.mock.calls[0][1]).toEqual({ force: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("also deletes the R2 object when configured", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";

    await deleteBackupFile(VALID);
    expect(rmMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
    const { input } = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(input.Key).toBe(`backups/${VALID}`);
    expect(input.Bucket).toBe("dashboard");
  });

  // Pruning must stay idempotent: the local copy is already gone, so an R2
  // failure cannot be allowed to abort the caller's record cleanup.
  it("does not throw when the R2 delete fails", async () => {
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET = "dashboard";
    sendMock.mockRejectedValueOnce(new Error("R2 network error"));

    await expect(deleteBackupFile(VALID)).resolves.toBeUndefined();
  });
});
