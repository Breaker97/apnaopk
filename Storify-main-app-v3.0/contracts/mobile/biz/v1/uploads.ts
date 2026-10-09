import * as z from "zod";
import { ImageSet } from "./common";
import { OperationStatus } from "./operations";

export const UPLOAD_PURPOSES = ["product_media", "digital_asset", "digital_preview", "return_evidence", "return_label"] as const;
/** A new-product upload is tied to that editor's UUID; record targets are checked in workspace scope. */
export const UploadTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("product"), id: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("product_draft"), id: z.string().uuid() }),
  z.object({ kind: z.literal("return"), id: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("order"), id: z.string().min(1).max(64) }),
]);
export type UploadTarget = z.infer<typeof UploadTarget>;
/** Multipart: target is JSON, purpose is text, file is binary. No caller-supplied owner/storage key. */
export const BizUploadRequest = z.object({ purpose: z.enum(UPLOAD_PURPOSES), target: UploadTarget });
export type BizUploadRequest = z.infer<typeof BizUploadRequest>;
export const BizUpload = z.object({
  id: z.string(), purpose: z.enum(UPLOAD_PURPOSES), target: UploadTarget,
  filename: z.string(), mimeType: z.string(), size: z.number().int().nonnegative(),
  private: z.boolean(), image: ImageSet.optional(), url: z.string().optional(),
  /** Only public product media have a persistent URL; private files need a scoped refresh. */
  expiresAt: z.string().optional(),
});
export type BizUpload = z.infer<typeof BizUpload>;
export const BizUploadResult = z.object({ operation: OperationStatus, upload: BizUpload });
export type BizUploadResult = z.infer<typeof BizUploadResult>;
export const BizUploadAccess = z.object({ url: z.string(), expiresAt: z.string() });
export type BizUploadAccess = z.infer<typeof BizUploadAccess>;
export const UploadPolicy = z.object({
  purpose: z.enum(UPLOAD_PURPOSES), maxBytes: z.number().int().positive(),
  mimeTypes: z.array(z.string()), maxFiles: z.number().int().positive(),
});
export type UploadPolicy = z.infer<typeof UploadPolicy>;
export const BIZ_UPLOAD_REASONS = ["UPLOAD_TOO_LARGE", "UPLOAD_TYPE_NOT_ALLOWED", "UPLOAD_NOT_AVAILABLE", "UPLOAD_TARGET_CHANGED"] as const;
