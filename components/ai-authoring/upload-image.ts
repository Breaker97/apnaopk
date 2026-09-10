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
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
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
