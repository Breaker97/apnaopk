/**
 * Server-side upload handling for digital product deliverables.
 *
 * Unlike media uploads these bypass the public-media pipeline entirely: no
 * WebP re-encode, no MIME allowlist (an ebook can be a zip, epub, license
 * key file, …), and the bytes land in PRIVATE storage under the caller's
 * scope prefix. Only the order-gated download route can serve them back.
 */

import { getStorageService } from "@/lib/storage";
import { MAX_DIGITAL_FILE_SIZE_MB } from "@/lib/products/digital-assets";

type UploadedDigitalAssetRecord = {
  _id: string;
  filename: string;
  storageKey: string;
  size: number;
  mimeType?: string;
};

export async function uploadDigitalAssetFiles(
  files: File[],
  scopePrefix: string,
): Promise<{ uploaded: UploadedDigitalAssetRecord[]; errors: string[] }> {
  const storage = await getStorageService();
  const uploaded: UploadedDigitalAssetRecord[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!(file instanceof File)) continue;
    try {
      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > MAX_DIGITAL_FILE_SIZE_MB) {
        throw new Error(
          `File too large (${sizeMB.toFixed(1)}MB > ${MAX_DIGITAL_FILE_SIZE_MB}MB limit)`,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await storage.uploadPrivateFile(buffer, {
        fileName: file.name || "download",
        contentType: file.type || "application/octet-stream",
        fileSize: buffer.length,
        // Trailing slash → key generator appends a collision-safe directory
        // and the sanitized original filename under this scope.
        customPath: scopePrefix,
      });

      uploaded.push({
        _id: crypto.randomUUID(),
        filename: file.name || "download",
        storageKey: result.key,
        size: buffer.length,
        mimeType: file.type || undefined,
      });
    } catch (error) {
      errors.push(
        `${file.name}: ${error instanceof Error && error.message ? error.message : "Upload failed"}`,
      );
    }
  }

  return { uploaded, errors };
}
