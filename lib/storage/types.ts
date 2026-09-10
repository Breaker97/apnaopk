/**
 * Storage Types
 * TypeScript interfaces for storage providers
 */

/**
 * Backends an admin can choose. All four are S3-compatible and share
 * `S3CompatibleProvider` — they differ only in how the endpoint is derived and
 * which fields the admin has to supply:
 *
 *   cloudflare_r2  endpoint from accountId, region always "auto"
 *   s3             no endpoint (real AWS), region required
 *   minio          endpoint typed in full (self-hosted, any host)
 *   digitalocean   endpoint from region (<region>.digitaloceanspaces.com)
 */
export type StorageProvider =
  | "cloudflare_r2"
  | "s3"
  | "minio"
  | "digitalocean";

/**
 * What a settings document may hold. `"local"` is a legacy value, not an
 * option: installs created before v1.5 still carry it, and their media sits on
 * the server's disk. It is no longer offered in the admin, but it keeps
 * resolving so those files stay reachable until the store picks a real
 * provider and migrates.
 */
export type StoredStorageProvider = StorageProvider | "local";

/** The four an admin can actually choose, as a runtime list. */
export const SELECTABLE_STORAGE_PROVIDERS = [
  "cloudflare_r2",
  "s3",
  "minio",
  "digitalocean",
] as const satisfies readonly StorageProvider[];

/**
 * Every media type the uploader will ever accept, and the ceiling the admin's
 * own allow-list is checked against.
 *
 * `storage.allowedMimeTypes` is the only content-type gate `validateUpload`
 * applies, and it arrives from a settings save — so without a fixed list above
 * it, a crafted request could add `text/html` and turn the store's public
 * bucket into a host for attacker-supplied pages served from the merchant's own
 * media domain. The admin narrows this list; nothing may widen it.
 */
export const SUPPORTED_UPLOAD_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/x-icon",
  // Videos
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  // 3D models
  "model/gltf-binary",
  "model/gltf+json",
  "application/octet-stream",
  // Documents
  "application/pdf",
] as const;

export function isSupportedUploadMimeType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (SUPPORTED_UPLOAD_MIME_TYPES as readonly string[]).includes(
      value.trim().toLowerCase(),
    )
  );
}

/**
 * Ceiling for the per-type size limits, in megabytes. Not a capability claim —
 * it exists so a mistyped or hostile value cannot ask the server to buffer an
 * arbitrarily large upload.
 */
export const MAX_UPLOAD_SIZE_MB = 5120;

/**
 * Whether a value names a provider that can be configured and tested.
 *
 * Guards the boundary where a provider arrives over HTTP: without it an
 * unrecognized string fell through to the AWS branch of the client
 * constructor, and `"local"` — which a pre-v1.5 draft still carries — reached
 * the retired provider and answered a perfectly good R2 test with "local
 * storage was retired".
 */
export function isSelectableStorageProvider(
  value: unknown,
): value is StorageProvider {
  return (SELECTABLE_STORAGE_PROVIDERS as readonly string[]).includes(
    value as string,
  );
}

/**
 * Display names, in one place so a server error message and the admin UI never
 * disagree about what a provider is called. (This module is pure types + this
 * map, so client components can import it without pulling in the AWS SDK.)
 */
export const STORAGE_PROVIDER_LABELS: Record<StoredStorageProvider, string> = {
  cloudflare_r2: "Cloudflare R2",
  s3: "AWS S3",
  minio: "MinIO",
  digitalocean: "DigitalOcean Spaces",
  local: "Local Storage (legacy)",
};

export interface StorageConfig {
  provider: StoredStorageProvider;
  accountId?: string; // Cloudflare R2 Account ID
  endpoint?: string;
  region?: string;
  bucketName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicUrl?: string;
  maxFileSizeMB: number;
  // Per-media-type limits, Shopify-style. When set, the type-specific
  // limit takes precedence over maxFileSizeMB for that kind of file.
  maxImageSizeMB?: number;
  maxVideoSizeMB?: number;
  maxModelSizeMB?: number;
  allowedMimeTypes: string[];
  pathPrefix?: string;
}

export interface UploadOptions {
  // File details
  fileName: string;
  contentType: string;
  fileSize: number;

  // Optional metadata
  metadata?: Record<string, string>;

  // Custom path (overrides default)
  customPath?: string;

  /**
   * Owner segment inserted right after the path prefix, e.g. `vendor/<id>`.
   *
   * Always derived on the server from the session — never accepted over HTTP.
   * `customPath` is client-supplied and validated for *shape* only, so it can
   * name any folder including another vendor's; the scope is what actually
   * binds an object to its owner. With it, a marketplace can measure a
   * vendor's storage, bill for it, and delete everything they uploaded with a
   * single prefix.
   */
  ownerScope?: string;
}

export interface UploadResult {
  success: boolean;
  key: string; // Storage key/path
  url: string; // Public URL
  size: number;
  contentType: string;
}

export interface PresignedUrlResult {
  success: boolean;
  uploadUrl: string; // Presigned PUT URL
  publicUrl: string; // Final public URL after upload
  key: string; // Storage key
  expiresIn: number; // Seconds until expiration
}

export interface DeleteResult {
  success: boolean;
  key: string;
}

export interface StorageObject {
  key: string;
  url: string;
  size: number;
  lastModified?: string; // ISO timestamp
}

/**
 * How a private (non-public) file reaches the customer. S3/R2 hand out a
 * short-lived always-signed URL to redirect to; local storage has no signing,
 * so the app streams the bytes itself through the authenticated route.
 */
export type PrivateDownload =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; body: ReadableStream<Uint8Array>; size?: number };

export interface PrivateDownloadOptions {
  /** Seconds a signed redirect URL stays valid (redirect providers only). */
  expiresInSeconds?: number;
  /** Original filename for the Content-Disposition header. */
  filename?: string;
}

export interface ListFilesOptions {
  /** Provider-specific continuation token from a previous page. */
  cursor?: string;
  /** Max objects per page (default 50). */
  limit?: number;
}

export interface ListFilesResult {
  success: boolean;
  files: StorageObject[];
  /** Present when more pages exist; pass back as `cursor`. */
  nextCursor?: string;
}

export interface StorageService {
  /**
   * Generate a presigned URL for direct upload
   */
  getPresignedUploadUrl(options: UploadOptions): Promise<PresignedUrlResult>;

  /**
   * Upload a file directly (server-side)
   */
  uploadFile(file: Buffer, options: UploadOptions): Promise<UploadResult>;

  /**
   * Delete a file from storage
   */
  deleteFile(key: string): Promise<DeleteResult>;

  /**
   * List stored files under the configured path prefix (paginated).
   * Powers the admin Media Library for every provider.
   */
  listFiles(options?: ListFilesOptions): Promise<ListFilesResult>;

  /**
   * A URL the browser can actually load for this key right now. Equals the
   * public URL normally; S3/R2 buckets with no public URL configured get a
   * short-lived presigned GET URL instead (used by the admin Media Library).
   */
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Get public URL for a stored file
   */
  getPublicUrl(key: string): string;

  /**
   * Check if storage is configured and accessible
   */
  testConnection(): Promise<{ success: boolean; message: string }>;

  /**
   * Upload a file that must NEVER be publicly reachable (digital product
   * deliverables). Local storage writes outside `public/`; S3/R2 store under
   * the caller's key as-is. The result's `url` is always "" — private files
   * are only reachable through getPrivateDownload.
   *
   * Note for S3/R2: privacy also depends on the bucket — a bucket with public
   * access enabled (or an R2 custom domain) exposes every key. Installs
   * selling digital products should keep the bucket private and rely on the
   * signed URLs this interface produces.
   */
  uploadPrivateFile(file: Buffer, options: UploadOptions): Promise<UploadResult>;

  /**
   * Resolve a private file for delivery to an already-authorized customer.
   */
  getPrivateDownload(
    key: string,
    options?: PrivateDownloadOptions,
  ): Promise<PrivateDownload>;

  /**
   * Delete a private file (idempotent).
   */
  deletePrivateFile(key: string): Promise<DeleteResult>;
}
