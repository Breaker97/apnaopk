import "server-only";

import sharp from "sharp";
import { WEBP_CONTENT_TYPE, webpFileName } from "./webp-name";
import { WEBP_CONVERSION_ENABLED } from "./webp-policy";

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
 * Vector image types — the ones a WebP re-encode would destroy rather than
 * compress, since sharp can only rasterize them to a fixed size.
 *
 * Keeping the vector is NOT the default. An SVG is a document that can carry
 * script, and stored raw it is served from the store's own media host, so
 * the general upload path rasterizes it like any other image. Only a caller
 * that has asked for it — the brand logo, which has to stay sharp at every
 * size and is uploaded by someone who already manages store media — gets the
 * original bytes (see `keepVector`).
 */
const VECTOR_TYPES = new Set<string>(["image/svg+xml"]);

export function isVectorImageType(contentType: string): boolean {
  return VECTOR_TYPES.has(contentType.trim().toLowerCase());
}

/**
 * Whether an image of this type should be re-encoded to WebP.
 *
 * `keepVector` is the logo exception and nothing else: it spares a vector
 * source and has no effect on any raster format.
 *
 * With WEBP_CONVERSION_ENABLED off, raster images are stored exactly as
 * uploaded — but a vector is still rasterized. That step is there to stop a
 * script-bearing SVG being served from the store's own media host, so it is
 * not the compression switch's to turn off.
 */
export function shouldConvertToWebp(
  contentType: string,
  options: { keepVector?: boolean } = {},
): boolean {
  const vector = isVectorImageType(contentType);
  if (options.keepVector && vector) return false;
  return WEBP_CONVERSION_ENABLED || vector;
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

/**
 * Pixel dimensions of an image that is being stored without re-encoding.
 *
 * convertImageToWebp reports width/height as a by-product of the encode, so a
 * stored original has to be probed for them — otherwise a media record simply
 * loses the dimensions the conversion used to supply.
 *
 * Returns null for anything libvips cannot read, which the caller has to
 * interpret: storeAsUploaded only probes formats sharp is known to handle, so
 * a null there means the bytes are not a real image and the upload is refused.
 */
export async function imageDimensions(
  buffer: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height, orientation } = await sharp(buffer).metadata();
    if (!width || !height) return null;
    // EXIF orientations 5-8 rotate by a quarter turn, and the browser applies
    // that when it renders the stored original — so the box the image occupies
    // is the transpose of the stored one. convertImageToWebp never had to
    // account for this: `.rotate()` bakes the rotation into the pixels it writes.
    const quarterTurned =
      typeof orientation === "number" && orientation >= 5 && orientation <= 8;
    return quarterTurned ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}
