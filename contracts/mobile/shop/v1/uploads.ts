/**
 * Photos the shopper uploads from the app: a review's photos, the profile
 * picture.
 *
 * POST /uploads (auth user, private, refused on a demo store): one photo per
 * request, as `multipart/form-data`, the file in the field `file` with its
 * Content-Type (`image/jpeg`, …). Answers 201 `Upload`: its `id`, to name it
 * afterwards (`CreateReviewRequest.uploadIds`, `UpdateReviewRequest.photoIds`,
 * `UpdateMeRequest.imageUploadId`), and the picture as it will be shown. An id
 * is good only for the shopper who uploaded it, and may be named again (a
 * retry of the request that uses it).
 *
 * The limits are the server's: `UploadPolicy`, sent with the review limits
 * (`ReviewLimits.photo`). Today a photo may be at most `UPLOAD_MAX_BYTES`
 * (less when the store sets a smaller image limit) and of a type in
 * `UPLOAD_ALLOWED_TYPES`. Shrink a camera photo before sending it.
 *
 * Refusals, with `reason` (`UPLOAD_REASONS`):
 * - 400 VALIDATION_ERROR `UPLOAD_MISSING`: no file in the field `file`.
 * - 413 VALIDATION_ERROR `UPLOAD_TOO_LARGE`: over `UploadPolicy.maxBytes`.
 * - 400 VALIDATION_ERROR `UPLOAD_TYPE_NOT_ALLOWED`: not a photo type the
 *   store takes.
 * - 400 VALIDATION_ERROR `UPLOAD_UNREADABLE`: the bytes are not a picture
 *   that can be read.
 * - 400 VALIDATION_ERROR `UPLOAD_NOT_FOUND` (on the routes that name an
 *   upload): an id that is not one of this shopper's uploads.
 */
import * as z from "zod";

import { ImageSet } from "./common";

/** The most bytes a photo from the app may have, whatever the store allows. */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/** The photo types the app may send. */
export const UPLOAD_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

export const UPLOAD_REASONS = [
  "UPLOAD_MISSING",
  "UPLOAD_TOO_LARGE",
  "UPLOAD_TYPE_NOT_ALLOWED",
  "UPLOAD_UNREADABLE",
  "UPLOAD_NOT_FOUND",
] as const;
export type UploadReason = (typeof UPLOAD_REASONS)[number];

/** What a photo may be, with the store's own limits applied. */
export const UploadPolicy = z.object({
  /** The largest file, in bytes. */
  maxBytes: z.number().int(),
  /** The Content-Types taken. */
  allowedTypes: z.array(z.string()),
});
export type UploadPolicy = z.infer<typeof UploadPolicy>;

/** POST /uploads (201) */
export const Upload = z.object({
  /** Name the photo by it afterwards. */
  id: z.string(),
  /** The photo as the store serves it. */
  image: ImageSet,
  /** As stored. */
  mimeType: z.string(),
  /** In bytes, as stored. */
  size: z.number().int(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});
export type Upload = z.infer<typeof Upload>;
