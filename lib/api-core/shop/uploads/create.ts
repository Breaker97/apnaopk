import * as z from "zod";
import { UPLOAD_REASONS, Upload } from "@/contracts/mobile/shop/v1/uploads";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { imageSet } from "@/lib/api-core/shop/images";
import {
  APP_UPLOAD_BODY_BYTES,
  ShopperUploadError,
  storeShopperUpload,
} from "@/lib/media-upload/shopper-uploads";

/** The form POST /uploads reads: one file, in the field `file`. */
const UploadForm = z.object({ file: z.unknown() });

/**
 * POST /uploads: one photo from the shopper app, stored as the website
 * stores a shopper's upload (photos only, the store's limits, the app's own
 * ceiling under the proxy's body cap), and recorded as the shopper's so it
 * can be named by id on a review or as their picture.
 */
export const uploadRoute = defineRoute({
  id: "uploads.create",
  method: "POST",
  path: "/uploads",
  auth: "user",
  cache: { kind: "private" },
  status: 201,
  rateLimit: { bucket: "upload:create", preset: "moderate" },
  demo: "block-mutations",
  form: { maxBytes: APP_UPLOAD_BODY_BYTES, files: ["file"] },
  reasons: { values: UPLOAD_REASONS },
  input: UploadForm,
  output: Upload,
  handler: async ({ input, session }) => {
    try {
      const stored = await storeShopperUpload(session.user.id, input.file);
      const image = imageSet(stored.url);
      if (!image) throw new Error(`The stored upload has no URL the app can load: ${stored.url}`);
      return {
        id: String(stored._id),
        image,
        mimeType: stored.mimeType,
        size: stored.size,
        ...(stored.width !== undefined ? { width: stored.width } : {}),
        ...(stored.height !== undefined ? { height: stored.height } : {}),
      };
    } catch (error) {
      if (!(error instanceof ShopperUploadError)) throw error;
      throw new MobileApiError(error.reason === "UPLOAD_TOO_LARGE" ? 413 : 400, "VALIDATION_ERROR", error.message, {
        reason: error.reason,
        errors: { file: [error.message] },
      });
    }
  },
});
