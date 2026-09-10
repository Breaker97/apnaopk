import "server-only";

import { createHash } from "node:crypto";

/**
 * Installed-app icons, rendered on demand from the admin-configured source
 * image by `app/app-icon/[spec]/route.ts`.
 *
 * Why a render route instead of pointing the manifest straight at the uploaded
 * file: Chrome refuses to offer installation unless the manifest advertises a
 * square icon of at least 192px, and it verifies that by downloading the image
 * and measuring the real bitmap — a declared `sizes` value it cannot confirm
 * buys nothing. Store owners upload brand assets at whatever size their
 * designer handed them (the shipped default favicon is 28x31), so the only way
 * to guarantee conforming icons is to resize server-side.
 */

type AppIconSize = 192 | 512;

type AppIconPurpose = "any" | "maskable";

export interface AppIconSpec {
  size: AppIconSize;
  purpose: AppIconPurpose;
}

/**
 * Fraction of a maskable icon that Android is guaranteed to leave uncropped.
 * The artwork is scaled into that inner square and the remainder is padded, so
 * a round/squircle mask never clips the logo.
 */
export const MASKABLE_SAFE_ZONE_RATIO = 0.8;

/** Padding colour for maskable icons; matches the manifest `background_color`. */
export const APP_ICON_BACKGROUND = "#ffffff";

/** The icons the manifest advertises, in the order it lists them. */
export const APP_ICON_MANIFEST_SPECS: readonly AppIconSpec[] = [
  { size: 192, purpose: "any" },
  { size: 512, purpose: "any" },
  { size: 512, purpose: "maskable" },
];

const SPEC_PATTERN = /^(?:(maskable)-)?(192|512)\.png$/;

/** Parses the `[spec]` route segment, e.g. `512.png` / `maskable-512.png`. */
export function parseAppIconSpec(segment: string): AppIconSpec | undefined {
  const match = SPEC_PATTERN.exec(segment);
  if (!match) return undefined;

  return {
    size: Number(match[2]) as AppIconSize,
    purpose: match[1] === "maskable" ? "maskable" : "any",
  };
}

/**
 * Cache-busting token derived from the source URL. Uploads are content
 * addressed (timestamp + random suffix), so a changed icon always yields a new
 * token — which is what lets the render route be cached immutably.
 */
export function appIconVersion(sourceUrl: string): string {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 8);
}

export function appIconPath(spec: AppIconSpec, version: string): string {
  const name =
    spec.purpose === "maskable" ? `maskable-${spec.size}.png` : `${spec.size}.png`;
  return `/app-icon/${name}?v=${version}`;
}
