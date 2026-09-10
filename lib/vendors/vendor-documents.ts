/**
 * Vendor verification (KYC) document references.
 *
 * These are identity documents — business licenses, government IDs — so new
 * uploads land in PRIVATE storage (uploadPrivateFile) and the Vendor record
 * stores the storage KEY, not a URL. Keys are only resolvable through the
 * admin-authenticated download route. Values saved before this change are
 * public URLs (absolute for R2/S3, site-relative for local storage) and stay
 * viewable as-is, so both shapes are accepted everywhere a reference is
 * validated.
 *
 * Kept free of server imports: the admin upload field needs the key check to
 * build its "View" link in the browser.
 */

import { z } from "zod";

export const VENDOR_DOCUMENT_KEY_PREFIX = "vendor-documents/";

/** Accepted document formats, shared by the upload routes and both UI fields. */
export const VENDOR_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const VENDOR_DOCUMENT_ACCEPT = VENDOR_DOCUMENT_MIME_TYPES.join(",");

export const VENDOR_DOCUMENT_MAX_SIZE_MB = 10;

const SAFE_KEY_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** Storage scope for one applicant's documents during registration. */
export function vendorDocumentScope(userId: string): string {
  const segment = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${VENDOR_DOCUMENT_KEY_PREFIX}${segment || "unscoped"}/`;
}

/**
 * A private-storage key minted by the vendor document upload routes. The
 * segment check is what keeps the download route scoped: "." / ".." segments
 * would let a crafted key escape the vendor-documents/ prefix on the local
 * provider and read other private files (digital product deliverables).
 */
export function isVendorDocumentKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(VENDOR_DOCUMENT_KEY_PREFIX)) return false;
  if (value.length > 512) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) =>
      SAFE_KEY_SEGMENT.test(segment) && segment !== "." && segment !== "..",
  );
}

/**
 * Anything the documents fields may store: a private key (new uploads) or a
 * legacy public URL — absolute (R2/S3) or site-relative (local storage).
 */
export function isVendorDocumentReference(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  if (isVendorDocumentKey(value)) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Where the admin UI sends someone who clicks "View" on a document: private
 * keys go through the authenticated download route, legacy URLs open
 * directly.
 */
export function vendorDocumentViewUrl(reference: string): string {
  return isVendorDocumentKey(reference)
    ? `/api/admin/vendors/documents?key=${encodeURIComponent(reference)}`
    : reference;
}

/**
 * Zod shape for a stored document field: empty, a private key, or a legacy
 * URL. Shared by the apply payload and the onboarding draft so the two can't
 * drift on what counts as a valid reference.
 */
export function vendorDocumentReferenceSchema(message: string) {
  return z
    .string()
    .refine(isVendorDocumentReference, message)
    .optional()
    .or(z.literal(""));
}
