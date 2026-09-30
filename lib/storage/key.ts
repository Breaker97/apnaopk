/**
 * Storage Key Generation
 *
 * Shared by every storage provider so the object-key layout (prefix +
 * date-partitioned folders + a collision-safe upload directory) is identical
 * no matter where the bytes actually land — Cloudflare R2, AWS S3, or local.
 */

import type { UploadOptions } from "./types";

/**
 * Directory-style customPath values that are safe to accept from a client:
 * one or more slash-terminated segments of conservative characters. The
 * trailing slash is what forces generateStorageKey down its
 * append-a-unique-directory branch — a bare (non-slash) customPath becomes
 * the WHOLE object key, which would let a caller point a presigned PUT at an
 * existing object and overwrite it. Dots are excluded entirely so no segment
 * can be "." or "..".
 */
const SAFE_UPLOAD_DIRECTORY = /^(?:[a-zA-Z0-9_-]{1,64}\/){1,8}$/;

/**
 * Whether a client-supplied customPath may be forwarded to
 * generateStorageKey. Server-side callers passing their own constants don't
 * need this; it exists for routes that accept the value over HTTP.
 */
export function isSafeUploadDirectory(value: unknown): value is string {
  return typeof value === "string" && SAFE_UPLOAD_DIRECTORY.test(value);
}

/**
 * Normalize the configured path prefix into the slash-terminated form every
 * key builder assumes.
 *
 * The admin types this by hand and nothing enforced the trailing slash, so
 * "media" produced keys like `media2026/08/…` — the prefix silently fused with
 * the date folder, and the media library (which lists by prefix) still found
 * them, so the damage only showed up as unexplainable key names. Empty and
 * dot segments are dropped too: a ".." would escape the base directory on the
 * legacy local provider's listing walk.
 *
 * Returns "" for a blank value; callers apply their own default.
 */
export function normalizePathPrefix(value: string | undefined | null): string {
  if (typeof value !== "string") return "";
  const segments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.length ? `${segments.join("/")}/` : "";
}

/** Key segment for everything one vendor uploads. */
export function vendorMediaScope(vendorId: string): string {
  const segment = String(vendorId).replace(/[^a-zA-Z0-9_-]/g, "");
  return segment ? `vendor/${segment}` : "";
}

/**
 * Normalize an owner scope into a slash-terminated key fragment. Defensive
 * even though callers build it server-side: a stray "." segment here would
 * escape the prefix on the local provider, the same class of bug
 * `isVendorDocumentKey` guards against.
 */
function scopeFragment(ownerScope: string | undefined): string {
  if (!ownerScope) return "";
  const segments = ownerScope
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);
  return segments.length ? `${segments.join("/")}/` : "";
}

/**
 * The folder one owner's objects live in: the path prefix plus their scope.
 * Shared by the key builder and the listing, so the folder a vendor uploads
 * into and the folder their media library shows are the same by construction.
 */
export function ownerPrefix(
  pathPrefix: string | undefined,
  ownerScope: string | undefined,
): string {
  return `${pathPrefix || ""}${scopeFragment(ownerScope)}`;
}

/**
 * 128 random bits for the key's unique directory, from the platform's
 * cryptographic generator (Node and browsers both have it).
 *
 * It was six base-36 characters of Math.random — about 31 bits from a
 * generator whose output every public upload response shows. Private files
 * (digital deliverables, KYC documents, expense receipts) use these keys too,
 * so a key has to be unguessable, not merely unique.
 */
function randomKeySegment(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Build the storage object key for an upload.
 *
 * Layout: `<prefix><owner scope?><customPath | YYYY/MM>/<unique dir>/<name>`
 */
export function generateStorageKey(
  pathPrefix: string | undefined,
  options: UploadOptions,
): string {
  const prefix = ownerPrefix(pathPrefix, options.ownerScope);
  const timestamp = Date.now();
  const randomSuffix = randomKeySegment();

  // Keep the original basename visible at the end of the public URL. Only
  // characters that are unsafe in an object key are replaced; casing and the
  // extension are preserved. A unique parent directory prevents same-name
  // uploads from overwriting one another without changing the filename.
  const originalBaseName = options.fileName.split(/[\\/]/).pop() || "upload";
  const sanitizedName =
    originalBaseName
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "") || "upload";
  const uploadDirectory = `${timestamp}-${randomSuffix}`;

  if (options.customPath) {
    // A trailing slash marks customPath as a target directory rather than a
    // full object key. Append a collision-safe directory and the original
    // filename so callers passing only a folder (e.g. "ai-generated/") don't
    // all write to the same key and silently overwrite one another.
    if (options.customPath.endsWith("/")) {
      return `${prefix}${options.customPath}${uploadDirectory}/${sanitizedName}`;
    }
    return `${prefix}${options.customPath}`;
  }

  // Generate path: uploads/2024/01/timestamp-random/filename.ext
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${prefix}${year}/${month}/${uploadDirectory}/${sanitizedName}`;
}
