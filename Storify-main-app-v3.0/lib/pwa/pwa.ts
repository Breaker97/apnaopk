const PWA_CACHE_PREFIX = "storify-pwa-";
/** Prefixes shipped by earlier versions; cleaned up on activate and on unregister. */
const LEGACY_PWA_CACHE_PREFIXES = ["marketify-pwa-"];
export const SERVICE_WORKER_PATH = "/sw.js";

export function isAppCacheKey(key: string) {
  return (
    key.startsWith(PWA_CACHE_PREFIX) ||
    LEGACY_PWA_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function shouldEnableServiceWorker() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_ENABLE_PWA_IN_DEV === "true"
  );
}
