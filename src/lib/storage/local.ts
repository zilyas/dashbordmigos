import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp, { type FormatEnum, type Metadata, type Sharp as SharpInstance } from "sharp";

const UPLOAD_SUBDIR = "uploads/products";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MIN_DIMENSION = 10;
const MAX_DIMENSION = 8000;

const ALLOWED_EXTENSIONS: Partial<Record<keyof FormatEnum, string>> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

export interface UploadAdapter {
  save(file: File): Promise<string>;
}

/**
 * Local disk adapter — writes into /public/uploads/products and returns a
 * public URL. Swap for an UploadThing-backed adapter later without touching
 * call sites (same `save(file): Promise<string>` interface).
 *
 * The upload is decoded with sharp rather than trusted by its client-supplied
 * MIME type or filename — sharp only succeeds on genuine image bytes, so a
 * renamed executable, or a polyglot file (valid image bytes with an
 * appended script payload), is either rejected outright or re-encoded away.
 * The re-encode also strips EXIF/metadata.
 */
export const localUploadAdapter: UploadAdapter = {
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

    const extension = metadata.format ? ALLOWED_EXTENSIONS[metadata.format] : undefined;
    if (!extension) {
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

    const oriented = image.rotate();
    let outputBuffer: Buffer;
    switch (metadata.format) {
      case "jpeg":
        outputBuffer = await oriented.jpeg({ quality: 90 }).toBuffer();
        break;
      case "png":
        outputBuffer = await oriented.png().toBuffer();
        break;
      case "webp":
        outputBuffer = await oriented.webp({ quality: 90 }).toBuffer();
        break;
      case "gif":
        outputBuffer = await oriented.gif().toBuffer();
        break;
      default:
        throw new Error("Unsupported file type. Use JPEG, PNG, WEBP or GIF.");
    }

    const filename = `${randomUUID()}.${extension}`;
    const dir = path.join(process.cwd(), "public", UPLOAD_SUBDIR);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), outputBuffer);

    return `/${UPLOAD_SUBDIR}/${filename}`;
  },
};
