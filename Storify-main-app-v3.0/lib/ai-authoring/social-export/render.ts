import sharp, { type Sharp } from "sharp";

import type {
  RenderedSocialExport,
  SocialExportFormat,
  SocialExportOptions,
} from "./types";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
/** Logo lockup width as a fraction of the export width. */
const LOGO_WIDTH_RATIO = 0.16;
const LOGO_MARGIN_RATIO = 0.04;

type Rgba = { r: number; g: number; b: number; alpha: number };

/**
 * Parse a #rgb / #rrggbb color to an sharp background object. Falls back to
 * the supplied default (used for an unset or malformed setting) so a bad hex
 * never breaks an export.
 */
export function parseHexColor(
  value: string | undefined,
  fallback: Rgba,
): Rgba {
  if (typeof value !== "string") return fallback;
  const hex = value.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: 1,
  };
}

function contentType(format: SocialExportFormat): string {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

function encode(pipeline: Sharp, format: SocialExportFormat): Sharp {
  return format === "jpeg"
    ? pipeline.jpeg({ quality: 90, mozjpeg: true })
    : pipeline.png({ compressionLevel: 9 });
}

/**
 * Render a source image (typically an AI Studio result) into one exact social
 * size. `cover` fills the frame and may crop; `pad` contains the whole image
 * on a solid background (the brand color). An optional logo is composited into
 * the bottom-right corner.
 */
export async function renderSocialExport(
  input: Buffer,
  options: SocialExportOptions,
): Promise<RenderedSocialExport> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new Error("Image is too large to export");
  }
  const { width, height } = options.size;
  const white: Rgba = { r: 255, g: 255, b: 255, alpha: 1 };
  const pad = parseHexColor(options.padColor, white);

  const base = sharp(input, { failOn: "error" }).rotate();

  let framed: Sharp;
  if (options.mode === "pad") {
    // Contain the whole image on the brand-color background.
    framed = base.resize({
      width,
      height,
      fit: "contain",
      background: pad,
    });
  } else {
    // Fill the frame; flatten transparency onto the pad color for jpeg.
    framed = base.resize({ width, height, fit: "cover", position: "centre" });
    if (options.format === "jpeg") {
      framed = framed.flatten({ background: pad });
    }
  }

  // Resolve to a concrete buffer before compositing so the logo overlays the
  // final, correctly-sized canvas.
  let canvas = await encode(framed, options.format).toBuffer();

  if (options.logo && options.logo.length) {
    const logoWidth = Math.max(48, Math.round(width * LOGO_WIDTH_RATIO));
    const margin = Math.round(width * LOGO_MARGIN_RATIO);
    const logo = await sharp(options.logo, { failOn: "error" })
      .resize({ width: logoWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    const logoMeta = await sharp(logo).metadata();
    const top = Math.max(
      0,
      height - (logoMeta.height ?? logoWidth) - margin,
    );
    const left = Math.max(0, width - (logoMeta.width ?? logoWidth) - margin);
    canvas = await encode(
      sharp(canvas).composite([{ input: logo, top, left }]),
      options.format,
    ).toBuffer();
  }

  const metadata = await sharp(canvas).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error("Social export produced unexpected dimensions");
  }
  if (canvas.length > MAX_OUTPUT_BYTES) {
    throw new Error("Exported image exceeds the file-size limit");
  }

  return {
    buffer: canvas,
    width,
    height,
    format: options.format,
    contentType: contentType(options.format),
  };
}
