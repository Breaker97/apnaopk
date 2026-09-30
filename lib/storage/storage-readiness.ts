/**
 * What a storage provider needs before the app can build a client for it.
 *
 * The one rule behind both of the admin's readiness signals: Settings →
 * Storage's "Connected" chip (`/api/admin/storage/status`, which reads the
 * resolved config) and the settings sidebar's attention dot (which only sees
 * the browser's copy: values, `_meta` presence flags and `.env` flags). Each
 * caller answers "is this field set?" its own way; the rule stays one.
 *
 * Client-safe: no imports.
 */

export type StorageReadinessField =
  | "bucketName"
  | "accessKeyId"
  | "secretAccessKey"
  | "accountId"
  | "endpoint";

export function isStorageConfigured(
  /** Already normalized: an unrecognized provider reads as "cloudflare_r2". */
  provider: string,
  has: (field: StorageReadinessField) => boolean,
): boolean {
  // Retired in v1.5. A store still on it can serve what it already has but
  // cannot accept a single new upload, so reporting it as configured would
  // put a green chip on a storefront that is one product away from failing.
  if (provider === "local") return false;

  if (!has("bucketName") || !has("accessKeyId") || !has("secretAccessKey")) {
    return false;
  }

  // The one extra field each backend needs before a client can be built.
  switch (provider) {
    case "cloudflare_r2":
      return has("accountId");
    case "minio":
      return has("endpoint");
    default:
      // AWS S3 and DigitalOcean Spaces derive their endpoint from the region,
      // which always has a schema default.
      return true;
  }
}
