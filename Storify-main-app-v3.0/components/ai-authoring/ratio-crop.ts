"use client";

/**
 * Shared post-process for ratio-locked AI Studio surfaces: center-crop a fresh
 * generation/edit result to the surface's exact frame and re-upload it, so the
 * on-stage and saved image already match what the storefront renders. If the
 * crop or upload fails, warn and fall back to the original result rather than
 * blocking the generation — the merchant still gets an image, just not
 * pre-cropped.
 */

import { toast } from "@/components/ui/toast-notification";
import { cropToRatioBlob } from "@/components/ai-authoring/studio-effects";
import { uploadImageFile } from "@/components/ai-authoring/upload-image";
import type { AIAuthoringMediaResponse } from "@/lib/ai-authoring/types";

export function makeRatioCropPostProcess(options: {
  width: number;
  height: number;
  /** Filename for the re-uploaded crop, e.g. "blog-featured-16x9.png". */
  filename: string;
  /** How the frame reads in the fallback warning, e.g. "16:9". */
  ratioLabel: string;
}): (response: AIAuthoringMediaResponse) => Promise<AIAuthoringMediaResponse> {
  const { width, height, filename, ratioLabel } = options;

  return async (response) => {
    try {
      const blob = await cropToRatioBlob(response.media.url, width, height);
      const file = new File([blob], filename, { type: "image/png" });
      const media = await uploadImageFile(file);
      return {
        ...response,
        media: {
          ...response.media,
          _id: media._id,
          url: media.url,
          mimeType: media.mimeType || "image/png",
          filename: file.name,
          size: media.size ?? blob.size,
          width: media.width ?? width,
          height: media.height ?? height,
        },
      };
    } catch (error) {
      toast.warning(
        error instanceof Error
          ? `Could not crop to ${ratioLabel} (${error.message}); using the original image.`
          : `Could not crop to ${ratioLabel}; using the original image.`,
      );
      return response;
    }
  };
}
