import type { ImageSet } from "@/contracts/mobile/shop/v1/common";
import { appBaseUrl } from "@/lib/app-url";
import { isTrustedRemoteUrl } from "@/lib/remote-image-domains";

/**
 * The image port: a stored picture as the three sizes the app loads
 * (contracts … common.ts, `ImageSet`). Every picture the mobile API sends
 * goes through `imageSet`; nothing else builds an image URL.
 *
 * Each size is a URL of the store's own optimizer (`/_next/image`). The widths
 * are ones it accepts with no image config (Next 16 takes 32–384 and
 * 640–3840, quality 75 only, and answers 400 to anything else) and ones the
 * web asks for too, so the optimizer's cache serves both clients and an image
 * is encoded once. The optimizer picks WebP or AVIF from the request's
 * `Accept` header: the app's image loader must send `Accept: image/webp`, or
 * it is sent the original format.
 *
 * What the optimizer cannot load goes out as it is, in all three sizes. That
 * is the decision the web's `AppImage` makes (components/ui/app-image.tsx): an
 * SVG (the optimizer refuses vectors), a data URI, a host outside next.config's
 * remotePatterns (media kept under a previous storage provider's domain).
 */

const IMAGE_WIDTHS = { thumb: 256, card: 640, full: 1080 } as const;

const IMAGE_QUALITY = 75;

const VECTOR = /\.svgz?(?:[?#]|$)/i;

function optimized(source: string, width: number): string {
  return `${appBaseUrl()}/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${IMAGE_QUALITY}`;
}

function sameForEverySize(url: string, alt: string | undefined): ImageSet {
  return { thumb: url, card: url, full: url, ...(alt ? { alt } : {}) };
}

/**
 * One picture as the contract's `ImageSet`, or nothing when there is no
 * picture an app could load (empty, a browser `blob:` URL, a scheme other
 * than http(s) or data).
 */
export function imageSet(
  src: string | null | undefined,
  alt?: string | null,
): ImageSet | undefined {
  let source = typeof src === "string" ? src.trim() : "";
  if (!source) return undefined;
  const label = typeof alt === "string" && alt.trim() ? alt.trim() : undefined;

  if (source.startsWith("data:image/")) return sameForEverySize(source, label);
  if (source.startsWith("//")) source = `https:${source}`;

  if (/^https?:\/\//i.test(source)) {
    if (VECTOR.test(source) || !isTrustedRemoteUrl(source)) {
      return sameForEverySize(source, label);
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
    return undefined;
  } else {
    // A file this store serves itself, which the optimizer reads by its path.
    if (!source.startsWith("/")) source = `/${source}`;
    if (VECTOR.test(source)) return sameForEverySize(`${appBaseUrl()}${source}`, label);
  }

  return {
    thumb: optimized(source, IMAGE_WIDTHS.thumb),
    card: optimized(source, IMAGE_WIDTHS.card),
    full: optimized(source, IMAGE_WIDTHS.full),
    ...(label ? { alt: label } : {}),
  };
}
