import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import sharp from "sharp";

// Mock the S3 client so no network call is made; capture what would be sent.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { r2UploadAdapter, isR2Configured } from "@/lib/storage/r2";

async function makePngFile(width = 40, height = 40): Promise<File> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
  return new File([buf], "photo.png", { type: "image/png" });
}

beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "acct123";
  process.env.R2_ACCESS_KEY_ID = "key123";
  process.env.R2_SECRET_ACCESS_KEY = "secret123";
  process.env.R2_BUCKET = "dashboard";
  process.env.R2_PUBLIC_BASE_URL = "https://pub-test.r2.dev";
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

describe("isR2Configured", () => {
  it("is true when all vars are set", () => {
    expect(isR2Configured()).toBe(true);
  });
});

describe("r2UploadAdapter.save", () => {
  it("processes to a 500x500 webp, uploads to R2, and returns the public URL", async () => {
    const file = await makePngFile();
    const url = await r2UploadAdapter.save(file);

    // URL shape: public base + products/<uuid>.webp
    expect(url).toMatch(/^https:\/\/pub-test\.r2\.dev\/products\/[0-9a-f-]{36}\.webp$/);

    // One PutObject with webp content-type and a real buffer body.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const { input } = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(input.Bucket).toBe("dashboard");
    expect(input.ContentType).toBe("image/webp");
    expect(input.Key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(Buffer.isBuffer(input.Body)).toBe(true);

    // The uploaded bytes really are a 500x500 webp.
    const meta = await sharp(input.Body as Buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(500);
  });

  it("rejects a non-image file", async () => {
    const bad = new File([Buffer.from("this is not an image")], "note.txt", { type: "text/plain" });
    await expect(r2UploadAdapter.save(bad)).rejects.toThrow(/not a valid image/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a file over 5MB before decoding", async () => {
    const big = { size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    await expect(r2UploadAdapter.save(big)).rejects.toThrow(/too large/i);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
