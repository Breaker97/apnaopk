import "server-only";

import { toFile } from "openai";
import sharp from "sharp";

import { ValidationError } from "@/lib/api/errors";
import { undecodableImageType } from "@/lib/media-upload/webp";

/**
 * The image-edit API reads the file's declared MIME type and accepts only
 * JPEG, PNG and WebP. The store's own uploads are kept exactly as uploaded
 * (see WEBP_CONVERSION_ENABLED), so an AVIF, GIF, TIFF or SVG source reached
 * the provider with its own type and was refused with a 400.
 */
const PROVIDER_FORMATS = {
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  png: { contentType: "image/png", extension: "png" },
  webp: { contentType: "image/webp", extension: "webp" },
} as const;

/**
 * A converted source is capped on its longest side. Lossless PNG of a large
 * AVIF photo can grow far past the provider's per-file limit, and the model
 * works at 1024-1536px anyway.
 */
const CONVERTED_MAX_SIDE = 2048;

/** The name a user would recognise, for the formats libvips cannot decode. */
const UNDECODABLE_LABELS: Record<string, string> = {
  "image/heic": "HEIC",
  "image/bmp": "BMP",
  "image/x-icon": "ICO",
};

export interface AiSourceImage {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

function notEditable(detail: string): ValidationError {
  return new ValidationError(
    `${detail} Please use a JPG, PNG or WebP image.`,
  );
}

/**
 * Turn a stored source image into something the AI provider accepts.
 *
 * The format is read from the bytes, never from the `content-type` header, so a
 * mislabelled file is handled too. JPEG, PNG and WebP go through untouched;
 * anything else libvips can read (AVIF, GIF, TIFF, SVG, ...) becomes a PNG.
 * Formats the bundled libvips cannot decode (HEIC, BMP, ICO) are refused with a
 * message the user can act on rather than the provider's raw 400.
 */
export async function toAiSourceImage(buffer: Buffer): Promise<AiSourceImage> {
  const undecodable = undecodableImageType(buffer);
  if (undecodable) {
    const label = UNDECODABLE_LABELS[undecodable] ?? "This";
    throw notEditable(`${label} images can't be edited with AI yet.`);
  }

  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    throw notEditable("This image couldn't be read.");
  }

  if (format && format in PROVIDER_FORMATS) {
    const accepted = PROVIDER_FORMATS[format as keyof typeof PROVIDER_FORMATS];
    return { buffer, ...accepted };
  }

  try {
    const png = await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({
        width: CONVERTED_MAX_SIDE,
        height: CONVERTED_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return { buffer: png, ...PROVIDER_FORMATS.png };
  } catch {
    throw notEditable("This image couldn't be converted for AI editing.");
  }
}

/** A source image as the provider's upload file, converted when it must be. */
export async function aiSourceFile(buffer: Buffer, baseName: string) {
  const source = await toAiSourceImage(buffer);
  return toFile(source.buffer, `${baseName}.${source.extension}`, {
    type: source.contentType,
  });
}
