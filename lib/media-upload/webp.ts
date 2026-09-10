import "server-only";

import sharp from "sharp";
import { WEBP_CONTENT_TYPE, webpFileName } from "./webp-name";

// Re-exported so existing server-side importers keep their import path.
export { webpFileName };

interface ConvertedWebp {
  buffer: Buffer;
  fileName: string;
  contentType: typeof WEBP_CONTENT_TYPE;
  fileSize: number;
  width: number;
  height: number;
}

/**
 * Image types stored exactly as uploaded rather than re-encoded.
 *
 * SVG is vector. sharp happily rasterizes it to a fixed-size WebP, which
 * silently turned every uploaded logo into a bitmap that blurs when scaled —
 * and dropped the thing that made an SVG worth uploading. The browser
 * pipeline already refuses to touch SVG (client-webp.ts); this keeps the
 * server path from disagreeing with it.
 */
const NEVER_CONVERT = new Set<string>(["image/svg+xml"]);

/** Whether an image of this type should be re-encoded to WebP. */
export function shouldConvertToWebp(contentType: string): boolean {
  return !NEVER_CONVERT.has(contentType.trim().toLowerCase());
}

/**
 * ISO-BMFF brands that mean HEVC-coded HEIC. The AVIF brand uses the same
 * container and IS decodable, so it is deliberately absent.
 */
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/**
 * Identify a real image whose format the bundled libvips cannot decode.
 *
 * The prebuilt sharp binaries ship without the codecs for BMP, ICO and
 * HEVC-coded HEIC, yet the storage allowlist offers all three — so those
 * uploads reached the encoder and died on "Unable to convert image to WebP".
 * Detecting them by signature lets the caller store the bytes untouched
 * (browsers render BMP and ICO natively) while genuinely corrupt files still
 * fail, which is what makes a broken upload visible instead of silently
 * stored.
 *
 * Returns the detected MIME type, or null when the bytes are not one of these
 * formats — including for every format sharp CAN decode.
 */
export function undecodableImageType(buffer: Buffer): string | null {
  // "BM"
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  // ICO (type 1) and CUR (type 2), little-endian in bytes 2-3.
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    (buffer[2] === 0x01 || buffer[2] === 0x02) &&
    buffer[3] === 0x00
  ) {
    return "image/x-icon";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 4, 8) === "ftyp" &&
    HEIC_BRANDS.has(buffer.toString("latin1", 8, 12))
  ) {
    return "image/heic";
  }
  return null;
}

export async function convertImageToWebp(
  buffer: Buffer,
  fileName: string,
): Promise<ConvertedWebp> {
  try {
    const { data, info } = await sharp(buffer, {
      animated: true,
      failOn: "error",
    })
      .rotate()
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    if (!info.width || !info.height) {
      throw new Error("Missing image dimensions");
    }

    return {
      buffer: data,
      fileName: webpFileName(fileName),
      contentType: WEBP_CONTENT_TYPE,
      fileSize: data.length,
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new Error("Unable to convert image to WebP");
  }
}
