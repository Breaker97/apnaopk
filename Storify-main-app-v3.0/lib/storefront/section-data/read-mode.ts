/**
 * How a section's loader meets a failed read.
 *
 * - `"page"`: the storefront page draws what it can. A failed price lookup
 *   drops the price; a shelf that cannot be read drops out of the page. The
 *   rest of the page renders.
 * - `"strict"`: the failure fails the whole answer. A static (ISR) mobile
 *   route caches its answer as a whole, so a gap there would be kept and
 *   served as the store's content until the next refresh
 *   (lib/storefront/cached-read.ts says why for cached reads in general).
 *
 * Loaders in this folder take the mode where the web swallows a failure; a
 * loader that never did simply throws.
 */
export type SectionReadMode = "page" | "strict";

/** `read()`, or in page mode its fallback when it fails. */
export async function readOr<T>(
  mode: SectionReadMode,
  read: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  if (mode === "strict") return read();
  try {
    return await read();
  } catch {
    return fallback();
  }
}
