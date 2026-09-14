import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp, { type FormatEnum, type Metadata, type Sharp as SharpInstance } from "sharp";
import type { UploadAdapter } from "@/lib/storage/local";

const UPLOAD_PREFIX = "products";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MIN_DIMENSION = 10;
const MAX_DIMENSION = 8000;
const OUTPUT_SIZE = 500;

// Accept the same source formats the local adapter does; everything is
// normalised to WebP on the way out.
const ALLOWED_FORMATS: (keyof FormatEnum)[] = ["jpeg", "png", "webp", "gif"];

function getEndpoint(): string {
  return (
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  );
}

/** True when all R2 settings are present, so the selector can prefer R2. */
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
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
 * Cloudflare R2 upload adapter. Same `save(file): Promise<string>` contract as
 * the local adapter, so call sites are unchanged.
 *
 * Uploads are never trusted by client-supplied MIME/filename: the bytes are
 * decoded with sharp (rejecting non-images and polyglots), then re-encoded to a
 * 500x500 `cover` WebP with metadata stripped, given a random UUID key, and
 * pushed to R2. The returned URL is served from the public R2 base.
 */
export const r2UploadAdapter: UploadAdapter = {
  async save(file: File) {
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error("File is too large. Maximum size is 5MB.");
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());

    let image: SharpInstance;
    let metadata: Metadata;
    try {
      image = sharp(inputBuffer, { animated: true });
      metadata = await image.metadata();
    } catch {
      throw new Error("File is not a valid image.");
    }

    if (!metadata.format || !ALLOWED_FORMATS.includes(metadata.format)) {
      throw new Error("Unsupported file type. Use JPEG, PNG, WEBP or GIF.");
    }

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new Error("Image is too small.");
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error(`Image is too large. Maximum dimension is ${MAX_DIMENSION}px.`);
    }

    // Normalise: honour EXIF orientation, crop-cover to a square, strip
    // metadata (default on re-encode), output WebP.
    const outputBuffer = await image
      .rotate()
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();

    const key = `${UPLOAD_PREFIX}/${randomUUID()}.webp`;

    await getClient().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET as string,
        Key: key,
        Body: outputBuffer,
        ContentType: "image/webp",
      })
    );

    const base = (process.env.R2_PUBLIC_BASE_URL as string).replace(/\/$/, "");
    return `${base}/${key}`;
  },
};
