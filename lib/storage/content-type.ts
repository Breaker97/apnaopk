/**
 * Content-type rules shared by the storage providers and the upload pipeline.
 * No imports, so the presigned-upload route can ask without loading sharp or
 * the AWS SDK.
 */

/**
 * The media type without its parameters: `IMAGE/SVG+XML; charset=utf-8` →
 * `image/svg+xml`. Browsers decide how to treat a file by this part alone.
 */
export function mimeEssence(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
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
 *
 * Read by essence: an upload declaring `image/svg+xml; charset=utf-8` used to
 * miss this check and be stored as a live SVG, while the allow-list, which
 * strips parameters, let it through.
 */
const VECTOR_TYPES = new Set<string>(["image/svg+xml"]);

export function isVectorImageType(contentType: string): boolean {
  return VECTOR_TYPES.has(mimeEssence(contentType));
}
