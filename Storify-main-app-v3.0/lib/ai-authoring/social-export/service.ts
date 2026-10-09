import { randomUUID } from "node:crypto";

import { getStorageService } from "@/lib/storage";
import { fetchSourceImage } from "@/lib/ai-authoring/media";

import { SOCIAL_EXPORT_SIZE_MAP } from "./presets";
import { renderSocialExport } from "./render";
import type {
  SocialExportRequest,
  SocialExportResponse,
} from "./types";

type SocialExportServiceInput = SocialExportRequest & {
  /** Brand pad color (pad mode background + jpeg flatten). Empty = white. */
  padColor?: string;
  /** Configured brand logo URL; only used when the request set useLogo. */
  logoUrl?: string;
  /** Alt text carried onto the exported media. */
  alt?: string;
};

/**
 * Fetch the (own-storage) source image, render it to the requested social
 * size, optionally lock a brand logo into the corner, and upload the result.
 * Deterministic and key-free — no OpenAI call.
 */
export async function createSocialExport(
  input: SocialExportServiceInput,
): Promise<SocialExportResponse> {
  const size = SOCIAL_EXPORT_SIZE_MAP[input.sizeKey];
  const { buffer: source } = await fetchSourceImage(input.sourceUrl);

  let logo: Buffer | undefined;
  if (input.useLogo && input.logoUrl) {
    // Same SSRF guard as the source — the logo must be our own asset too.
    logo = (await fetchSourceImage(input.logoUrl)).buffer;
  }

  const rendered = await renderSocialExport(source, {
    size,
    mode: input.mode,
    format: input.format,
    padColor: input.padColor,
    logo,
  });

  const extension = input.format === "jpeg" ? "jpg" : "png";
  const filename = `ai-social-${size.key}-${Date.now()}.${extension}`;
  const storage = await getStorageService();
  const uploaded = await storage.uploadFile(rendered.buffer, {
    fileName: filename,
    contentType: rendered.contentType,
    fileSize: rendered.buffer.length,
    customPath: "ai-generated/social/",
    metadata: {
      source: "ai-authoring",
      entity: "social-export",
      operation: `${size.key}-${input.mode}`,
    },
  });

  return {
    media: {
      _id: randomUUID(),
      url: uploaded.url,
      type: "image",
      mimeType: uploaded.contentType || rendered.contentType,
      filename,
      size: uploaded.size || rendered.buffer.length,
      width: rendered.width,
      height: rendered.height,
      ...(input.alt ? { alt: input.alt } : {}),
    },
    size: { key: size.key, width: size.width, height: size.height },
  };
}
