/**
 * HTTP cache policy for responses this app serves.
 *
 * Kept out of `next.config.ts` so the matcher can be unit-tested: a regression
 * in `APP_PAGE_HEADER_SOURCE` would either leave storefront documents
 * browser-cacheable again (stale catalog) or strip the immutable caching from
 * `/_next/static` (every build asset re-downloaded on every page view), and
 * neither failure is visible without inspecting response headers.
 */

/**
 * Matches app-page documents and their RSC payloads.
 *
 * Excluded, in order: the immutable build output, API routes (they set
 * `private, no-store` themselves via lib/api/response.ts), local uploads
 * (content-addressed, cached for a year), and any path containing a dot —
 * i.e. static files such as `/favicon.ico` or `/logo.png`.
 */
export const APP_PAGE_HEADER_SOURCE =
  "/:path((?!_next/|api/|uploads/|.*\\.).*)";

/**
 * Browsers must re-ask the server for every page.
 *
 * Next serves prerendered app pages with
 * `s-maxage=60, stale-while-revalidate=31535940`. Browsers ignore `s-maxage`
 * (shared caches only) but do honour `stale-while-revalidate`, so a page could
 * be served straight from the disk cache for up to a year and refreshed in the
 * background — a cache that survives quitting the browser, which is why newly
 * published catalog changes stayed invisible until a hard reload.
 *
 * `no-cache` still allows the browser to *store* the response and revalidate it
 * with `If-None-Match`, so unchanged pages come back as a 304. It only forbids
 * reusing a copy without asking. The server answers those revalidations from
 * the ISR + `unstable_cache` layers, so this costs a round trip, not a query.
 */
export const PAGE_CACHE_CONTROL = "private, no-cache, must-revalidate";

/**
 * JSON API payloads are per-request reads of live data and many are
 * session-scoped, so they must never be reused from any cache.
 */
export const API_CACHE_CONTROL = "private, no-store";

/**
 * Test helper mirroring how Next compiles `APP_PAGE_HEADER_SOURCE`.
 *
 * path-to-regexp turns `/:path(<pattern>)` into `^/(?:<pattern>)$`, so this
 * evaluates the same pattern the router does without booting Next.
 */
export function matchesAppPageSource(pathname: string): boolean {
  const pattern = APP_PAGE_HEADER_SOURCE.replace(/^\/:path\(/, "").replace(
    /\)$/,
    "",
  );
  return new RegExp(`^/(?:${pattern})$`).test(pathname);
}
