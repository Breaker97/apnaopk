/**
 * Browser-side image preparation for direct-to-storage uploads.
 *
 * The server pipeline (lib/media-upload/webp.ts) re-encodes every image to
 * WebP with sharp and records its dimensions. Direct-to-storage uploads never
 * reach the server, so that step has to happen here or uploads would regress
 * to storing originals with no width/height.
 *
 * Canvas gives us both: `toBlob("image/webp")` re-encodes, and the decoded
 * bitmap carries the dimensions. Quality 0.82 matches the sharp setting so the
 * two paths produce comparably sized files.
 *
 * With WEBP_CONVERSION_ENABLED off the re-encode is skipped, but the decode
 * still happens: the dimensions are the half of this module a direct upload
 * cannot get anywhere else.
 *
 * Anything this module cannot handle (unsupported codec, no WebP encoder,
 * a decode failure) resolves to `null` — callers fall back to the original
 * file rather than blocking the upload.
 */

import { WEBP_CONTENT_TYPE, webpFileName } from "./webp-name";
import { WEBP_CONVERSION_ENABLED } from "./webp-policy";

const WEBP_QUALITY = 0.82;

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
}

/**
 * Images the browser must not re-encode.
 *
 * SVG is a document, not a bitmap: a canvas cannot decode one safely (it
 * taints in some browsers) and has no intrinsic size to draw it at. So the
 * browser never converts one — it hands the original back and `uploadFile`
 * decides what happens next, sending it to the server to be rasterized
 * unless the caller asked to keep the vector (the brand logo).
 *
 * GIF is here because a canvas only ever holds ONE frame: re-encoding an
 * animated GIF produced a still image of its first frame, silently killing the
 * animation. sharp does handle animated input (`animated: true`), so the server
 * path converts GIFs to animated WebP; the browser has no equivalent, and
 * storing the original animation beats storing a frozen frame.
 *
 * ICO is the mirror image: the browser CAN decode it but the server cannot
 * (libvips ships without the codec — see undecodableImageType), so the server
 * path stores the original. A favicon uploaded as .ico must land as .ico
 * whichever path carried it, not as a WebP that older browsers ignore.
 */
const NEVER_RECONVERT = new Set([
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Decode via createImageBitmap when available (off-main-thread, handles EXIF
 * orientation with imageOrientation: "from-image", mirroring sharp's
 * `.rotate()`), falling back to an <img> element for older browsers.
 */
async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = url;
    });
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Report an image file's pixel dimensions, re-encoding it to WebP on the way
 * when WEBP_CONVERSION_ENABLED is on.
 *
 * Returns `null` when the file is not an image, must not be touched at all, or
 * the browser cannot decode/encode it — the caller then uploads the original
 * with no dimensions recorded.
 */
export async function prepareImageForUpload(
  file: File,
): Promise<PreparedImage | null> {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/")) return null;
  if (NEVER_RECONVERT.has(type)) return null;
  if (typeof document === "undefined") return null;

  const decoded = await decode(file);
  if (!decoded) return null;

  const { source, width, height } = decoded;
  try {
    // Re-encoding is off: hand the original bytes back and report only what
    // the decode learned. The caller uploads `file` either way, so returning
    // it here — rather than null — is what keeps width/height on the record.
    if (!WEBP_CONVERSION_ENABLED) return { file, width, height };

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, WEBP_CONTENT_TYPE, WEBP_QUALITY);
    // A browser without a WebP encoder silently hands back a PNG; storing that
    // under a .webp name would mislabel the object, so treat it as a miss.
    if (!blob || blob.type !== WEBP_CONTENT_TYPE) return null;

    return {
      file: new File([blob], webpFileName(file.name), {
        type: WEBP_CONTENT_TYPE,
      }),
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }
  }
}
