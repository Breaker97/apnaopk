/**
 * Outside a Next.js server there is no incremental cache, and every
 * `unstable_cache` wrapper throws the moment it is called ("Invariant:
 * incrementalCache missing"). A script that runs the app's own data readers
 * loads this first (`node --require`, which tsx passes through) so each
 * wrapper becomes the plain function it wraps. Nothing is cached and nothing
 * is revalidated: a script reads the database as it is now.
 */
const modulePath = require.resolve("next/cache");
const real = require("next/cache");

require.cache[modulePath] = {
  id: modulePath,
  filename: modulePath,
  loaded: true,
  exports: {
    ...real,
    unstable_cache: (fn) => fn,
    revalidateTag() {},
    revalidatePath() {},
    updateTag() {},
    cacheTag() {},
    cacheLife() {},
  },
};
