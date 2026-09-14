import { localUploadAdapter, type UploadAdapter } from "@/lib/storage/local";
import { isR2Configured, r2UploadAdapter } from "@/lib/storage/r2";

/**
 * Chooses the storage backend at call time: Cloudflare R2 when fully
 * configured (see `isR2Configured`), otherwise the local-disk adapter. Both
 * satisfy the same `UploadAdapter` interface, so callers never branch.
 */
export function getUploadAdapter(): UploadAdapter {
  return isR2Configured() ? r2UploadAdapter : localUploadAdapter;
}
