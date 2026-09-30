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
 * It extends an internal Next module. After a Next upgrade,
 * tests/page-cache-handler.test.ts says whether that module is still there.
 */
const FileSystemCache =
  require("next/dist/server/lib/incremental-cache/file-system-cache").default;

class MemoryOnlyCache extends FileSystemCache {
  constructor(ctx) {
    super({ ...ctx, flushToDisk: false });
  }
}

module.exports = MemoryOnlyCache;
