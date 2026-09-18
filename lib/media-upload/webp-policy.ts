/**
 * The master switch for the WebP re-encode, read by BOTH upload paths — the
 * server pipeline (webp.ts, sharp) and the browser one (client-webp.ts,
 * canvas). It lives in its own module for the same reason webp-name.ts does:
 * so the client can read it without dragging sharp into the bundle.
 *
 * Currently OFF. Quality 82 through either encoder visibly softened uploaded
 * photos, and re-encoding an already-lossy JPEG compounds that loss with no
 * way back once the original bytes are gone. Images are stored exactly as
 * uploaded until the encoder settings are retuned.
 *
 * What this does NOT switch off:
 *  - SVG rasterization. A vector is rasterized because raw SVG can carry
 *    script and is served from the store's own media host — a security
 *    measure, not a compression one (see shouldConvertToWebp).
 *  - next/image, which re-encodes to WebP/AVIF again at serve time at its own
 *    quality. That one is configured in next.config.ts.
 *
 * Turning this back on affects NEW uploads only; anything already stored as
 * .webp stays as it is.
 */
export const WEBP_CONVERSION_ENABLED = false;
