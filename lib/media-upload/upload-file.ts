import "server-only";

import { validateUpload } from "@/lib/storage";
import type { StorageConfig, StorageService } from "@/lib/storage";
import {
  convertImageToWebp,
  imageDimensions,
  isVectorImageType,
  shouldConvertToWebp,
  undecodableImageType,
} from "./webp";

type UploadedMediaKind =
  | "image"
  | "video"
  | "audio"
  | "model"
  | "document"
  | null;

interface UploadCandidate {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface UploadedMediaRecord {
  _id: string;
  url: string;
  key: string;
  type: UploadedMediaKind;
  mimeType: string;
  filename: string;
  size: number;
  width?: number;
  height?: number;
}

interface UploadMediaFileDependencies {
  config: StorageConfig;
  storage: StorageService;
  uploadedBy?: string;
  /**
   * Owner segment for the object key (e.g. `vendor/<id>`), from
   * `resolveUploadScope`. Server-derived only — see UploadOptions.ownerScope.
   */
  ownerScope?: string;
  createId?: () => string;
  /**
   * Skip the WebP re-encode and store the image exactly as uploaded. Required
   * when the file is handed to a third party that rejects WebP — the WhatsApp
   * Cloud API only accepts JPEG and PNG for image messages.
   */
  preserveOriginalFormat?: boolean;
  /**
   * Store a VECTOR source (SVG) exactly as uploaded instead of rasterizing
   * it to WebP. The brand logo's exception — it has to stay sharp at every
   * size — and a privilege, not a flag a caller may simply ask for: raw SVG
   * can carry script and is served from the store's own media host, so the
   * route only honours it for someone who already manages store media.
   */
  keepVector?: boolean;
  /**
   * Mime types this ONE call may store even when the storage allowlist omits
   * them, because the caller has already validated the file against a stricter
   * rule of its own.
   *
   * The chat attachments route checks every upload against the channel
   * capability table before getting here. Telegram is the only channel that
   * accepts audio, and the global allowlist has no audio types at all, so a
   * voice note passed the capability check and was then rejected here — leaving
   * Telegram's audio support unreachable. Passing the capability's own type list
   * keeps that authority in one place instead of widening `/api/upload` for
   * every caller in the app.
   */
  additionalAllowedMimeTypes?: string[];
}

interface PreparedUpload {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  fileSize: number;
  width?: number;
  height?: number;
}

const IMAGE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

function resolvedContentType(fileName: string, contentType: string): string {
  const declared = contentType.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function mediaKind(contentType: string): UploadedMediaKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (
    contentType.includes("gltf") ||
    contentType === "application/octet-stream"
  ) {
    return "model";
  }
  if (contentType === "application/pdf") return "document";
  return null;
}

/**
 * Widens only the type allowlist, never the size limits — those still come from
 * the storage configuration.
 */
function uploadConfig(dependencies: UploadMediaFileDependencies): StorageConfig {
  const extra = dependencies.additionalAllowedMimeTypes?.filter(Boolean);
  if (!extra?.length) return dependencies.config;
  return {
    ...dependencies.config,
    allowedMimeTypes: [
      ...dependencies.config.allowedMimeTypes,
      ...extra,
    ],
  };
}

/**
 * The upload as it will be stored when nothing re-encodes it.
 *
 * convertImageToWebp did two jobs beyond compression that a stored original
 * still needs: it reported width/height, and by failing it kept bytes that
 * are not a real image out of storage. `probePixels` asks for both — the
 * caller turns it off for the two cases where a failed probe would mean
 * nothing: a format libvips cannot read (BMP/ICO/HEIC, already identified by
 * undecodableImageType) and a vector, which has no pixel size at all.
 */
async function storeAsUploaded(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  probePixels: boolean,
): Promise<PreparedUpload> {
  const stored: PreparedUpload = {
    buffer,
    fileName,
    contentType,
    fileSize: buffer.length,
  };
  if (!probePixels) return stored;

  const dimensions = await imageDimensions(buffer);
  if (!dimensions) throw new Error("Unable to read the uploaded image");
  return { ...stored, ...dimensions };
}

function assertValidUpload(
  config: StorageConfig,
  fileSize: number,
  contentType: string,
) {
  const validation = validateUpload(config, fileSize, contentType);
  if (!validation.valid) {
    throw new Error(validation.error || "Upload is not valid");
  }
}

export async function uploadMediaFile(
  file: UploadCandidate,
  dependencies: UploadMediaFileDependencies,
): Promise<UploadedMediaRecord> {
  const originalContentType = resolvedContentType(file.name, file.type);
  const type = mediaKind(originalContentType);
  const config = uploadConfig(dependencies);

  assertValidUpload(config, file.size, originalContentType);

  const originalBuffer = Buffer.from(await file.arrayBuffer());
  // A BMP/ICO/HEIC reaching the encoder fails outright, so it is stored as
  // uploaded instead — see undecodableImageType. Corrupt bytes are a different
  // matter and must still be refused: whichever branch runs below, one of them
  // asks libvips to read the image and throws when it cannot.
  const undecodable = undecodableImageType(originalBuffer);
  const convertsToWebp =
    type === "image" &&
    !dependencies.preserveOriginalFormat &&
    shouldConvertToWebp(originalContentType, {
      keepVector: dependencies.keepVector,
    }) &&
    !undecodable;
  const prepared: PreparedUpload = convertsToWebp
    ? await convertImageToWebp(originalBuffer, file.name)
    : await storeAsUploaded(
        originalBuffer,
        file.name,
        originalContentType,
        type === "image" &&
          !undecodable &&
          !isVectorImageType(originalContentType),
      );

  assertValidUpload(config, prepared.fileSize, prepared.contentType);

  const stored = await dependencies.storage.uploadFile(prepared.buffer, {
    fileName: prepared.fileName,
    contentType: prepared.contentType,
    fileSize: prepared.fileSize,
    ownerScope: dependencies.ownerScope,
    metadata: dependencies.uploadedBy
      ? {
          uploadedBy: dependencies.uploadedBy,
          originalName: file.name,
        }
      : undefined,
  });

  return {
    _id: dependencies.createId?.() ?? crypto.randomUUID(),
    url: stored.url,
    key: stored.key,
    type,
    mimeType: prepared.contentType,
    filename: prepared.fileName,
    size: prepared.fileSize,
    ...(prepared.width !== undefined && prepared.height !== undefined
      ? { width: prepared.width, height: prepared.height }
      : {}),
  };
}
