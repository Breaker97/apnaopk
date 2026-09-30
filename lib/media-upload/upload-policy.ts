import "server-only";

import { isAdmin, isSeller, isVendor, type MinimalUser } from "@/lib/access/rbac";
import { mimeEssence } from "@/lib/storage/content-type";
import { MAX_UPLOAD_SIZE_MB, type StorageConfig } from "@/lib/storage/types";

/**
 * Who may put what into the store's media bucket.
 *
 * The storage limits are the store's own — a 1 GB video or a 500 MB 3D model
 * is right for a product page — and they applied to every signed-in account,
 * including a shopper who signed up a minute ago. A shopper uploads review
 * photos and an avatar and nothing else, so that is what a shopper may upload:
 * photos, at most 10 MB each (what the review form already tells them) and
 * four to a request (a review's four photos). Anyone who works in the store —
 * admin, vendor, staff — keeps the store's limits.
 */

const MB = 1024 * 1024;

const SHOPPER_UPLOAD_LIMITS = {
  maxFileBytes: 10 * MB,
  maxFiles: 4,
} as const;

/** What phones and cameras produce. No SVG: a shopper has no use for a vector. */
const SHOPPER_IMAGE_TYPES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

/** Files one request may carry. The store's own uploaders send one at a time. */
const MAX_FILES_PER_UPLOAD = 20;

/** Multipart boundaries and part headers, on top of the file bytes. */
const MULTIPART_OVERHEAD_BYTES = MB;

/** Not an admin, a vendor or staff — an account anyone can open by signing up. */
export function isShopper(user: MinimalUser): boolean {
  return !isAdmin(user) && !isVendor(user) && !isSeller(user);
}

export function maxFilesPerUpload(shopper: boolean): number {
  return shopper ? SHOPPER_UPLOAD_LIMITS.maxFiles : MAX_FILES_PER_UPLOAD;
}

/**
 * The largest request /api/upload will read. It has to take in the whole body
 * before it can look at a single file, and the route sits outside the proxy's
 * 10 MB body cap, so the size is checked while the bytes arrive. A shopper's
 * ceiling is four photos; anyone else's is the largest single file the store
 * allows.
 */
export function uploadBodyLimit(config: StorageConfig, shopper: boolean): number {
  if (shopper) {
    return (
      SHOPPER_UPLOAD_LIMITS.maxFiles * SHOPPER_UPLOAD_LIMITS.maxFileBytes +
      MULTIPART_OVERHEAD_BYTES
    );
  }
  const largestMB = Math.max(
    ...[
      config.maxFileSizeMB,
      config.maxImageSizeMB,
      config.maxVideoSizeMB,
      config.maxModelSizeMB,
    ].filter((value): value is number => Number.isFinite(value)),
  );
  return (
    Math.min(Number.isFinite(largestMB) ? largestMB : 0, MAX_UPLOAD_SIZE_MB) *
      MB +
    MULTIPART_OVERHEAD_BYTES
  );
}

/**
 * Refuses a file a shopper may not upload. The store's own type and size
 * limits still apply after this; the smaller of the two sizes wins.
 */
export function assertShopperUpload(
  contentType: string,
  size: number,
  config: StorageConfig,
): void {
  if (!SHOPPER_IMAGE_TYPES.has(mimeEssence(contentType))) {
    throw new Error(
      "Only photos can be uploaded (JPEG, PNG, GIF, WebP, AVIF or HEIC)",
    );
  }
  const storeLimitMB = config.maxImageSizeMB ?? config.maxFileSizeMB;
  const limit = Math.min(SHOPPER_UPLOAD_LIMITS.maxFileBytes, storeLimitMB * MB);
  if (size > limit) {
    throw new Error(`Photos can be at most ${Math.floor(limit / MB)} MB`);
  }
}

export class UploadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`This upload is larger than ${Math.floor(limitBytes / MB)} MB`);
    this.name = "UploadTooLargeError";
  }
}

/**
 * `request.formData()`, refusing a body over `maxBytes`: at once when the
 * declared Content-Length is over, otherwise as soon as the bytes read pass
 * it, so an oversized request is never held in memory whole.
 */
export async function readUploadForm(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UploadTooLargeError(maxBytes);
  }
  if (!request.body) return request.formData();

  let received = 0;
  let tooLarge = false;
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          tooLarge = true;
          controller.error(new UploadTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  try {
    return await new Response(counted, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (tooLarge) throw new UploadTooLargeError(maxBytes);
    throw error;
  }
}
