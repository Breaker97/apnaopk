import "server-only";

import { createHash } from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import type { MetaImageCandidate } from "@/lib/meta-catalog/map-product";
import { getEnvRemoteImageDomains } from "@/lib/remote-image-domains";
import { DEMO_ASSET_ORIGINS } from "@/lib/seed-assets";
import { assertOwnStorageUrl } from "@/lib/storage/own-storage-url";

/**
 * Which URL Meta gets for a product picture.
 *
 * Meta reads JPEG and PNG only. A store's pictures are kept as uploaded, and
 * many are WebP (an earlier upload pipeline re-encoded everything to it), so
 * those are served through a JPEG rendition at
 * `/feeds/meta/<token>/images/<productId>/<mediaId>/<hash>.jpg` — behind the
 * feed's own token, so it is no open image converter, and only for a file
 * where `metaRenditionSource` allows, so the server never fetches an address a
 * seller typed (product imports hotlink other sites' images).
 */

const META_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png"]);

/** Whether Meta can read the stored file as it is. */
export function metaReadsImage(url: string, mimeType?: string | null): boolean {
  const type = mimeType?.trim().toLowerCase();
  if (type) return META_IMAGE_TYPES.has(type);
  return /\.(jpe?g|png)$/i.test(url.split(/[?#]/)[0]);
}

/**
 * Part of the rendition URL that changes with the picture, so the response
 * can be cached forever and a replaced picture is fetched again.
 */
export function metaImageHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function metaImageRenditionUrl(
  token: string,
  productId: string,
  mediaId: string,
  url: string,
): string {
  return `${appBaseUrl()}/feeds/meta/${token}/images/${productId}/${encodeURIComponent(
    mediaId,
  )}/${metaImageHash(url)}.jpg`;
}

/**
 * The stored picture as the URL the server may fetch to convert, or null.
 * The same places the 3D model proxy trusts (app/api/media/model): this
 * store's storage, the demo catalogue's buckets a seeded store's products
 * still point at, and the storage hosts named in the environment — never
 * "any bucket on a known storage host", and never another site.
 */
export async function metaRenditionSource(url: string): Promise<URL | null> {
  try {
    return await assertOwnStorageUrl(url);
  } catch {
    // Not the configured storage; the named places below may still be.
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (DEMO_ASSET_ORIGINS.includes(parsed.origin)) return parsed;
  const named = getEnvRemoteImageDomains().some(
    (domain) =>
      domain.hostname === parsed.hostname && `${domain.protocol}:` === parsed.protocol,
  );
  return named ? parsed : null;
}

/** The origin a stored URL points at, relative paths on this app's own. */
function originOf(url: string): string | null {
  try {
    return new URL(url, `${appBaseUrl()}/`).origin;
  } catch {
    return null;
  }
}

/**
 * Builds the mapper's `imageLink` for one feed run. Whether an origin may be
 * converted from takes a settings read, so it is answered once per origin,
 * ahead of each batch (`prepare`), and the link itself is then synchronous.
 */
export function createMetaImageLinker(token: string) {
  const convertibleOrigins = new Map<string, boolean>();

  async function prepare(images: Iterable<MetaImageCandidate>): Promise<void> {
    for (const image of images) {
      if (metaReadsImage(image.url, image.mimeType)) continue;
      const origin = originOf(image.url);
      if (!origin || convertibleOrigins.has(origin)) continue;
      convertibleOrigins.set(origin, (await metaRenditionSource(image.url)) !== null);
    }
  }

  function imageLink(productId: string, image: MetaImageCandidate): string | null {
    if (metaReadsImage(image.url, image.mimeType)) return absoluteUrl(image.url) ?? null;
    const origin = originOf(image.url);
    if (!image.mediaId || !origin || convertibleOrigins.get(origin) !== true) return null;
    return metaImageRenditionUrl(token, productId, image.mediaId, image.url);
  }

  return { prepare, imageLink };
}
