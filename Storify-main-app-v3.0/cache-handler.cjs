/**
 * Next's page and data cache, kept in memory instead of on disk.
 *
 * Next writes every page it renders on demand into `.next` (HTML, RSC payload
 * and prefetch segments), once per URL and language, and never deletes any of
 * it. Home and product pages are rendered on demand since 2.4, so a crawler
 * walking every product in every language, or anyone asking for made-up
 * product URLs (each 404 is kept too), grew the directory without end. On the
 * rig, 706 such requests added 359 MB in 13 seconds, on a disk that usually
 * also holds the database.
 *
 * This is Next's own `FileSystemCache` with its disk writes switched off.
 * Rendered pages and `unstable_cache` data live in Next's in-memory LRU,
 * bounded by `cacheMaxMemorySize` (PAGE_CACHE_MEMORY_MB in next.config.ts), so
 * the pages people actually visit stay cached and the long tail renders again
 * when it is asked for. What the build wrote is still read from disk. Tag
 * expiry, stale-while-revalidate and revalidate times are Next's own; nothing
 * else changes. A restart starts empty, and the first visit to a page renders
 * it again.
 *
 * Not `experimental.isrFlushToDisk: false`: that flag also switches off the
 * image optimizer's disk cache, and every product image would be re-encoded
 * on every request.
 *
 * One more rule, for the mobile API's cached routes (`/api/mobile/…`): a
 * refusal (4xx) is answered but never kept, and it drops whatever was kept for
 * that path. Next caches a route's 404 like a 200, so every made-up product
 * slug or locale asked for became an entry of its own: 25,000 of them grew the
 * heap by 54 MB, part of it in a map Next never evicts. Dropping the path also
 * retires the answer a product had before it was deleted or unpublished.
 *
 * It extends internal Next modules. After a Next upgrade,
 * tests/page-cache-handler.test.ts says whether they are still there.
 */
const FileSystemCache =
  require("next/dist/server/lib/incremental-cache/file-system-cache").default;
const {
  SharedCacheControls,
} = require("next/dist/server/lib/incremental-cache/shared-cache-controls.external");

function isMobileApiRefusal(key, data) {
  return (
    data?.kind === "APP_ROUTE" &&
    data.status >= 400 &&
    data.status < 500 &&
    typeof key === "string" &&
    key.startsWith("/api/mobile/")
  );
}

class MemoryOnlyCache extends FileSystemCache {
  constructor(ctx) {
    super({ ...ctx, flushToDisk: false });
  }

  async set(key, data, ctx) {
    if (isMobileApiRefusal(key, data)) {
      FileSystemCache.memoryCache?.remove(key);
      SharedCacheControls.cacheControls.delete(key);
      return;
    }
    return super.set(key, data, ctx);
  }
}

module.exports = MemoryOnlyCache;
