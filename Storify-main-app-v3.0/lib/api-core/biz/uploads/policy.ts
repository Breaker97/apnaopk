import type { BizUploadRequest, UploadPolicy } from "@/contracts/mobile/biz/v1/uploads";
import { BIZ_UPLOAD_FILE_MAX_BYTES } from "@/lib/api-core/biz/upload-form";
import { MobileApiError } from "@/lib/api-core/errors";
import { validateUpload } from "@/lib/storage";
import { mimeEssence } from "@/lib/storage/content-type";
import { SUPPORTED_UPLOAD_MIME_TYPES, type StorageConfig } from "@/lib/storage/types";

const productMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm", "model/gltf-binary", "model/gltf+json"];
export function isPrivateBizUpload(purpose: BizUploadRequest["purpose"]): boolean {
  return purpose === "digital_asset" || purpose === "return_evidence" || purpose === "return_label";
}

/** The purpose policy is shared by form options and the actual upload boundary. */
export function bizUploadPolicy(purpose: BizUploadRequest["purpose"], config?: StorageConfig): UploadPolicy {
  let mimeTypes = purpose === "product_media" ? [...productMediaTypes]
    : purpose === "digital_preview" ? [...SUPPORTED_UPLOAD_MIME_TYPES]
      : purpose === "return_evidence" ? ["image/jpeg", "image/png", "image/webp", "application/pdf"]
        : purpose === "return_label" ? ["image/jpeg", "image/png", "application/pdf"] : [];
  let maxBytes = BIZ_UPLOAD_FILE_MAX_BYTES;
  if (!isPrivateBizUpload(purpose) && config) {
    mimeTypes = mimeTypes.filter((type) => validateUpload(config, 1, type).valid);
    if (!mimeTypes.length) throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "No file types are available for this upload.", { reason: "UPLOAD_NOT_AVAILABLE" });
    const limits = mimeTypes.map((type) => type.startsWith("image/") ? config.maxImageSizeMB ?? config.maxFileSizeMB
      : type.startsWith("video/") ? config.maxVideoSizeMB ?? config.maxFileSizeMB
        : type.includes("gltf") || type === "application/octet-stream" ? config.maxModelSizeMB ?? config.maxFileSizeMB : config.maxFileSizeMB);
    // One advertised ceiling per purpose must be safe for every advertised type.
    maxBytes = Math.min(maxBytes, ...limits.map((limit) => Math.floor(limit * 1024 * 1024)));
    if (maxBytes <= 0) throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "Uploads are not configured.", { reason: "UPLOAD_NOT_AVAILABLE" });
  }
  return { purpose, maxBytes, mimeTypes, maxFiles: purpose === "product_media" ? 250 : purpose === "digital_preview" || purpose === "return_label" ? 1 : 20 };
}

export function assertBizUploadFile(request: BizUploadRequest, file: Pick<File, "size" | "type">, config: StorageConfig): void {
  const policy = bizUploadPolicy(request.purpose, config);
  if (file.size <= 0 || file.size > policy.maxBytes) throw new MobileApiError(413, "VALIDATION_ERROR", "The file exceeds the upload limit.", { reason: "UPLOAD_TOO_LARGE" });
  if (policy.mimeTypes.length && !policy.mimeTypes.includes(mimeEssence(file.type))) throw new MobileApiError(400, "VALIDATION_ERROR", "This file type is not allowed.", { reason: "UPLOAD_TYPE_NOT_ALLOWED" });
}
