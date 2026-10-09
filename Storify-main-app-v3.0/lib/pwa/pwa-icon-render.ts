import "server-only";

import sharp from "sharp";
import {
  APP_ICON_BACKGROUND,
  MASKABLE_SAFE_ZONE_RATIO,
  type AppIconSpec,
} from "@/lib/pwa/pwa-icons";

/** Rasterize vector sources at a high enough density to fill a 512px canvas. */
const SVG_DENSITY = 384;

/**
 * Renders the admin-configured brand image at the exact size the PWA manifest
 * advertises. Sources are routinely smaller than the target (a favicon is 32px)
 * and are upscaled rather than rejected: a soft icon still lets the browser
 * offer installation, whereas an undersized one disqualifies the app entirely.
 */
export async function renderAppIcon(
  input: Buffer,
  spec: AppIconSpec,
): Promise<Buffer> {
  const image = sharp(input, { density: SVG_DENSITY, failOn: "error" }).rotate();

  if (spec.purpose === "any") {
    return image
      .resize(spec.size, spec.size, {
        fit: "contain",
        kernel: "lanczos3",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  // Maskable: fit the artwork inside the safe zone, then pad out to the full
  // canvas on an opaque background so a circular mask never clips the logo.
  const inner = Math.round(spec.size * MASKABLE_SAFE_ZONE_RATIO);
  const left = Math.floor((spec.size - inner) / 2);
  const top = Math.floor((spec.size - inner) / 2);

  return image
    .resize(inner, inner, {
      fit: "contain",
      kernel: "lanczos3",
      background: APP_ICON_BACKGROUND,
    })
    .extend({
      left,
      top,
      right: spec.size - inner - left,
      bottom: spec.size - inner - top,
      background: APP_ICON_BACKGROUND,
    })
    .flatten({ background: APP_ICON_BACKGROUND })
    .png()
    .toBuffer();
}
