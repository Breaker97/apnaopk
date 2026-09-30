/**
 * The storefront pages served from the cache — the home page and a product
 * page, in every language — and the one rule that keeps them shared safely:
 * only a bare URL renders the copy every visitor gets.
 *
 * Next renders a cached page on the request that finds it missing or out of
 * date, and that render records the request's own URL, query string included,
 * in the router payload of the HTML it stores (`c`, `q` and the page segment's
 * key — Next 16.3). Whatever the first visitor's URL carried — a campaign's
 * `utm_*`, an ad click id, a location filter's `lat`/`lng` — would then be in
 * the page source of everyone after them. So the proxy (proxy.ts) sends a URL
 * with a query string to the page's uncached twin
 * (app/[locale]/(store)/uncached/…), rendered for that request alone exactly
 * as it was before the page was cached, and only a bare URL reaches the cached
 * route. The browser still reads its own URL, so nothing on the page changes.
 *
 * A page that starts being cached (`generateStaticParams() { return [] }`)
 * belongs in `isCachedPagePath` and needs a twin; tests/storefront-isr-home.test.ts
 * checks both.
 */

/** The URL segment the uncached twins live under, right after the locale. */
export const UNCACHED_SEGMENT = "uncached";

/** Whether a locale-less storefront path is one of the cached pages. */
export function isCachedPagePath(path: string): boolean {
  return path === "/" || /^\/products\/[^/]+\/?$/.test(path);
}

/**
 * Whether the query string carries anything of the visitor's. Next's own
 * `_rsc` (a cache key it adds to client navigations) is the same on every
 * visitor's request for the same page, so it does not count.
 */
export function hasVisitorQuery(search: URLSearchParams): boolean {
  for (const key of search.keys()) {
    if (key !== "_rsc") return true;
  }
  return false;
}
