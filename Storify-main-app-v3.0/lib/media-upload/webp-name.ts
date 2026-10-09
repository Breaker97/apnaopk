/**
 * WebP naming constants shared by the server pipeline (webp.ts, which is
 * server-only because it pulls in sharp) and the browser pipeline
 * (client-webp.ts). Kept in its own module so the client can reuse the exact
 * naming rule without dragging sharp into the bundle.
 */

export const WEBP_CONTENT_TYPE = "image/webp" as const;

export function webpFileName(fileName: string): string {
  const lastSlash = Math.max(
    fileName.lastIndexOf("/"),
    fileName.lastIndexOf("\\"),
  );
  const lastDot = fileName.lastIndexOf(".");
  const base = lastDot > lastSlash ? fileName.slice(0, lastDot) : fileName;

  return `${base}.webp`;
}
