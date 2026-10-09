import "server-only";

/**
 * A cached read that answers with a fallback when it fails — without caching
 * the fallback.
 *
 * Wrap the `unstable_cache` reader, never catch inside it:
 *
 *   const getThings = withFallback(
 *     unstable_cache(async () => readThingsFromTheDatabase(), ["things"], {…}),
 *     () => [],
 *   );
 *
 * `unstable_cache` stores whatever its function returns. A reader that caught
 * its own database error and returned a default had the default stored as if
 * it were the data: `next build` with no database left the store named
 * "Storify", in one language, in `.next/cache` for the first visitors after an
 * in-place deploy; and on a running store a background refresh that hit a
 * database blip replaced good data with the default for a whole cache
 * lifetime. Let the error leave the cached function and nothing is stored —
 * a refresh that fails keeps serving the last good value, which is what Next
 * does with a throwing refresh — and only this one call gets the fallback.
 *
 * tests/cached-read-fallbacks.test.ts fails on a `catch` inside a cached
 * reader.
 */
export function withFallback<Args extends unknown[], T>(
  read: (...args: Args) => Promise<T>,
  fallback: (error: unknown, ...args: Args) => T,
): (...args: Args) => Promise<T> {
  return async (...args: Args) => {
    try {
      return await read(...args);
    } catch (error) {
      return fallback(error, ...args);
    }
  };
}
