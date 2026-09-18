/**
 * Client-side media upload.
 *
 * Prefers a direct browser → R2/S3 PUT so the file never passes through the
 * app server. Routing bytes through /api/upload caps every upload at the
 * hosting platform's request-body limit (4.5MB on Vercel), which is why large
 * product photos and any video failed in production but worked locally.
 *
 * Falls back to POST /api/upload when direct upload is unavailable:
 * local-storage installs (no presigning) and any failure to obtain or use a
 * presigned URL — a misconfigured bucket CORS policy being the likely one.
 * The fallback keeps small uploads working rather than failing outright.
 */

import {
  prepareImageForUpload,
  type PreparedImage,
} from "./client-webp";

interface DirectUploadResult {
  _id: string;
  url: string;
  key: string;
  type: "image" | "video" | "audio" | "model" | "document" | null;
  mimeType: string;
  filename: string;
  size: number;
  width?: number;
  height?: number;
}

interface UploadFileOptions {
  /** Sub-path within the storage prefix, e.g. "avatars/". */
  customPath?: string;
  /**
   * Keep a vector source (SVG) as it was uploaded instead of rasterizing it
   * to WebP. The brand logo's exception — everything else is re-encoded, so
   * an SVG cannot become a script-bearing document served from the store's
   * own media host. The server grants it only to a caller who manages store
   * media, so asking here is a request, not a decision.
   */
  keepVector?: boolean;
  /** Report 0–100 progress; only fires on the direct-upload path. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** Mirrors mediaKind() in lib/media-upload/upload-file.ts. */
function mediaKind(contentType: string): DirectUploadResult["type"] {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.includes("gltf") || type === "application/octet-stream") {
    return "model";
  }
  if (type === "application/pdf") return "document";
  return null;
}

/**
 * 3D models often arrive as application/octet-stream with the real format only
 * in the extension; the server resolves this the same way.
 */
function resolveContentType(file: File): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "glb") return "model/gltf-binary";
  if (extension === "gltf") return "model/gltf+json";
  return "application/octet-stream";
}

interface PresignResponse {
  success: boolean;
  supportsDirectUpload?: boolean;
  message?: string;
  data?: {
    uploadUrl: string;
    publicUrl: string;
    key: string;
    filename: string;
  } | null;
}

/**
 * PUT the bytes with XMLHttpRequest rather than fetch — fetch has no upload
 * progress events, and a progress bar is the whole point of moving large
 * files. Resolves false when the request itself fails (network/CORS), so the
 * caller can fall back; throws only on an explicit non-2xx from storage.
 */
function putToStorage(
  uploadUrl: string,
  file: File,
  contentType: string,
  options: UploadFileOptions,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl, true);
    request.setRequestHeader("Content-Type", contentType);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () =>
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
      });
    // A CORS rejection is indistinguishable from a network drop here; both
    // mean "direct upload did not work", which the caller treats as fallback.
    request.onerror = () => resolve({ ok: false, status: 0 });
    request.onabort = () =>
      reject(new DOMException("Upload aborted", "AbortError"));

    if (options.signal) {
      if (options.signal.aborted) {
        request.abort();
        return;
      }
      options.signal.addEventListener("abort", () => request.abort(), {
        once: true,
      });
    }

    request.send(file);
  });
}

/** Server-side upload: the original path, used as the fallback. */
async function uploadViaServer(
  file: File,
  options: UploadFileOptions,
): Promise<DirectUploadResult> {
  const formData = new FormData();
  formData.append("files", file);
  if (options.keepVector) formData.append("keepVector", "1");
  // customPath is intentionally not forwarded: /api/upload does not read it,
  // so the file lands under the default date-partitioned prefix. Only the
  // direct path honours customPath today.

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    signal: options.signal,
  });

  // A body-size rejection is produced by the platform, not the app, and often
  // is not JSON — give that case a message that names the real cause.
  if (response.status === 413) {
    throw new Error(
      "File is too large to upload through the server. Configure R2/S3 " +
        "storage with CORS enabled to upload large files.",
    );
  }

  const result = await response.json().catch(() => null);
  if (!result?.success || !Array.isArray(result.data) || !result.data[0]) {
    throw new Error(
      result?.errors?.length
        ? result.errors.join(", ")
        : result?.message || "Upload failed",
    );
  }
  return result.data[0] as DirectUploadResult;
}

/**
 * Upload one file, preferring the direct-to-storage path.
 *
 * Images go through prepareImageForUpload first, which mirrors whatever the
 * server pipeline does with sharp — re-encoding to WebP when that is switched
 * on, and either way reporting the width/height a direct upload has no other
 * way to learn.
 */
export async function uploadFile(
  original: File,
  options: UploadFileOptions = {},
): Promise<DirectUploadResult> {
  let prepared: PreparedImage | null = null;
  try {
    prepared = await prepareImageForUpload(original);
  } catch {
    prepared = null;
  }

  const file = prepared?.file ?? original;
  const contentType = resolveContentType(file);

  // A vector the caller has NOT asked to keep has to be rasterized, and only
  // the server can do that — a canvas cannot decode an SVG safely, so the
  // browser pipeline always hands it back untouched. Not presigning is what
  // sends it down /api/upload, where sharp re-encodes it like any other
  // image; the direct path would store the original bytes by default.
  const mustRasterize =
    contentType.toLowerCase() === "image/svg+xml" && !options.keepVector;

  let presigned: PresignResponse | null = null;
  try {
    const response = mustRasterize
      ? null
      : await fetch("/api/upload/presigned", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType,
            fileSize: file.size,
            customPath: options.customPath,
          }),
          signal: options.signal,
        });

    if (response) {
      presigned = (await response.json()) as PresignResponse;

      // A rejection here is a real validation failure (too large, wrong type)
      // that the server path would report identically — surface it rather
      // than retrying through a route that will refuse it too.
      if (!response.ok && presigned?.message) {
        throw new Error(presigned.message);
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Re-throw genuine validation errors; treat transport failures as
    // "presigning unavailable" and fall through to the server path.
    if (presigned?.message) throw error;
    presigned = null;
  }

  const direct = presigned?.supportsDirectUpload ? presigned.data : null;

  if (direct) {
    const { ok } = await putToStorage(
      direct.uploadUrl,
      file,
      contentType,
      options,
    );

    if (ok) {
      options.onProgress?.(100);
      return {
        _id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: direct.publicUrl,
        key: direct.key,
        type: mediaKind(contentType),
        mimeType: contentType,
        filename: file.name,
        size: file.size,
        ...(prepared
          ? { width: prepared.width, height: prepared.height }
          : {}),
      };
    }
    // Direct upload failed (most often a bucket without a CORS rule allowing
    // PUT from this origin). Fall through — the server path still works for
    // files under the platform limit.
  }

  return uploadViaServer(file, options);
}
