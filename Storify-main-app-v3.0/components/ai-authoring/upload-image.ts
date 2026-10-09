/**
 * Shared client helper for uploading an image file through the standard
 * /api/upload endpoint (same path, validation, and rate limit the media grid
 * uses). Returns the stored media object so callers can add it to the gallery
 * or assign it to a variant.
 */

export type UploadedImage = {
  _id: string;
  url: string;
  type?: string;
  mimeType?: string;
  alt?: string;
  size?: number;
  width?: number;
  height?: number;
};

export async function uploadImageFile(file: File): Promise<UploadedImage> {
  return uploadMediaAsset(file, "image");
}

/**
 * The same upload, for a surface that takes a video as well — a background
 * that plays. The endpoint already stores video (mp4, webm, ogg and mov are
 * in its allowlist); this only widens what the client will hand it.
 */
export async function uploadMediaAsset(
  file: File,
  kind: "image" | "video",
): Promise<UploadedImage> {
  if (!file.type.startsWith(`${kind}/`)) {
    throw new Error(
      kind === "video"
        ? "Please choose a video file"
        : "Please choose an image file",
    );
  }
  const formData = new FormData();
  formData.append("files", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.success || !result.data?.[0]) {
    throw new Error(
      Array.isArray(result.errors) && result.errors.length
        ? result.errors.join(", ")
        : result.message || "Upload failed",
    );
  }
  return result.data[0] as UploadedImage;
}
