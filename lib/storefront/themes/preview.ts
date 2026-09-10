import type { ThemeManifest } from "./types";

/**
 * A template's bundled screenshot, stamped with the theme version.
 *
 * `next.config.ts` sets `minimumCacheTTL: 31536000` on the premise that a URL's
 * bytes never change — true for uploaded media, whose storage keys carry a
 * timestamp and are never reused, but false for these captures: they ship in
 * `/public/templates/<id>/` and a release overwrites them in place when the
 * template is redesigned. Without a cache buster the optimizer keeps serving
 * last year's screenshot from `.next/cache/images` (which docs/STORAGE_SETUP.md
 * tells buyers to persist across deploys, so an upgrade does not clear it), and
 * every browser that already fetched it does the same.
 *
 * The manifest version is the right stamp: it is what a redesign bumps, and it
 * leaves the path in the manifest untouched, so the file still resolves on disk
 * for the test that pins it.
 *
 * The stamp is why every caller renders these `unoptimized`: Next's image
 * optimizer refuses a local `url` that carries a query ("url parameter is not
 * allowed"), so the choice is a versioned static file or an optimized stale
 * one. These are a handful of bundled screenshots on setup and gallery
 * screens, not catalogue media — correctness is worth more here than the
 * re-encode, and /public is served with `max-age=0`, so the new bytes land on
 * the next load.
 */
export function themePreviewSrc(
  manifest: Pick<ThemeManifest, "version" | "preview">,
  kind: "card" | "mobile",
): string | undefined {
  const asset = manifest.preview?.[kind];
  return asset ? `${asset}?v=${manifest.version}` : undefined;
}
