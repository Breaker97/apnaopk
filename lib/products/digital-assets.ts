/**
 * Digital product deliverables (Shopify Digital Downloads equivalent).
 *
 * Files are uploaded to PRIVATE storage under a scoped key prefix and
 * attached to products as `digitalAssets`. Customers reach them only through
 * the order-gated download route — the storage key itself must never appear
 * in any storefront payload.
 */

import { ValidationError } from "@/lib/api/errors";
import { getStorageService } from "@/lib/storage";

/** Cap for a single digital deliverable (Shopify Digital Downloads: 5GB). */
export const MAX_DIGITAL_FILE_SIZE_MB = 5120;

/** Seconds a signed download redirect stays valid. */
export const DIGITAL_DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Private-storage key prefix for a given uploader scope. Admin/staff uploads
 * share one scope; each vendor gets their own, which lets product-save
 * routes verify a vendor only ever attaches their own files.
 */
export function digitalAssetKeyPrefix(vendorId?: string | null): string {
  return vendorId ? `digital/v-${vendorId}/` : "digital/admin/";
}

/**
 * Reject any digital asset whose storage key is outside the caller's scope.
 * Called by the vendor product create/update routes; admins may attach any
 * key (they manage the whole catalog).
 */
export function assertOwnDigitalAssetKeys(
  assets: { storageKey: string; filename?: string }[] | undefined,
  vendorId: string,
): void {
  if (!assets?.length) return;
  const prefix = digitalAssetKeyPrefix(vendorId);
  const foreign = assets.filter((a) => !a.storageKey.startsWith(prefix));
  if (foreign.length > 0) {
    throw new ValidationError({
      digitalAssets: ["One or more files do not belong to your store"],
    });
  }
}

/**
 * Strip the private storage key from a product's digital assets before the
 * product is serialized into any storefront payload. Leaves name/size so the
 * PDP can show what a purchase includes.
 */
/**
 * Best-effort deletion of a hard-deleted product's private files. Mirrors
 * Shopify: the files belong to the product, so deleting it removes them —
 * entitlements are derived from the product doc, so past orders lose the
 * downloads either way. Failures are logged, never thrown: an unreachable
 * bucket must not block the product delete.
 */
export async function deleteProductDigitalFiles(
  assets: { storageKey: string }[] | undefined | null,
): Promise<void> {
  if (!assets?.length) return;
  try {
    const storage = await getStorageService();
    const results = await Promise.allSettled(
      assets.map((asset) => storage.deletePrivateFile(asset.storageKey)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Failed to delete digital file ${assets[index]?.storageKey}:`,
          result.reason,
        );
      }
    });
  } catch (error) {
    console.error("Failed to delete digital files:", error);
  }
}

/**
 * Delete the private files an update just detached from a product.
 *
 * The product form always sends the full `digitalAssets` list, so removing a
 * file there simply drops it from the array — without this the object stays in
 * private storage forever, paid for and unreachable. Keys still present in the
 * new list are left alone.
 *
 * `after` must be the list as it now stands. An absent list (`null`/`undefined`)
 * means the update never touched the files and nothing is deleted — only an
 * empty ARRAY says "the merchant removed them all".
 */
export async function deleteRemovedProductDigitalFiles(
  before: { storageKey?: string }[] | undefined | null,
  after: { storageKey?: string }[] | undefined | null,
): Promise<void> {
  if (!before?.length) return;
  if (!Array.isArray(after)) return;
  const kept = new Set(
    after
      .map((asset) => asset?.storageKey)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  );
  const removed = before.filter(
    (asset): asset is { storageKey: string } =>
      typeof asset?.storageKey === "string" &&
      asset.storageKey.length > 0 &&
      !kept.has(asset.storageKey),
  );
  await deleteProductDigitalFiles(removed);
}

export function sanitizeDigitalAssetsForStorefront<T extends object>(
  product: T,
): T {
  const assets = (product as { digitalAssets?: unknown }).digitalAssets;
  if (!Array.isArray(assets) || assets.length === 0) return product;
  return {
    ...product,
    digitalAssets: assets.map((asset: Record<string, unknown>) => ({
      _id: asset._id,
      filename: asset.filename,
      size: asset.size,
      mimeType: asset.mimeType,
    })),
  };
}
