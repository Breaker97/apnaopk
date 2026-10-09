"use client";

import {
  uploadMediaAsset,
  type UploadedImage,
} from "@/components/ai-authoring/upload-image";

/**
 * A product cutout from a plain photo: the background removed in the
 * browser, the result uploaded as a PNG with transparency, ready to be the
 * slide's artwork. The model runs on the merchant's machine (WebAssembly,
 * downloaded on first use and cached), so no picture leaves the store and
 * no key is needed.
 *
 * The photo is read through the app's own image route first — a bucket
 * that sends no CORS headers would otherwise refuse the browser the pixels
 * — and straight from its origin if that route will not serve it.
 */
export async function removeArtworkBackground(
  src: string,
  onProgress?: (share: number) => void,
): Promise<UploadedImage> {
  const input = await fetchPicture(src);
  const { removeBackground } = await import("@imgly/background-removal");
  const cutout = await removeBackground(input, {
    // The lighter weights: a hero cutout needs a clean edge, not a print.
    model: "isnet_fp16",
    output: { format: "image/png", quality: 1 },
    progress: (_key, current, total) => {
      if (onProgress && total > 0) onProgress(current / total);
    },
  });
  const file = new File([cutout], "cutout.png", { type: "image/png" });
  return uploadMediaAsset(file, "image");
}

async function fetchPicture(src: string): Promise<Blob> {
  const candidates = src.startsWith("data:") || src.startsWith("blob:")
    ? [src]
    : [`/_next/image?url=${encodeURIComponent(src)}&w=1920&q=90`, src];
  let lastError: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Not an image");
      return blob;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read the picture");
}
