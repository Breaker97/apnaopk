"use client";

import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

/**
 * `false` while this component hydrates the server's HTML, `true` from the
 * first client-only render on. A per-component gate: the page hydrates one
 * Suspense boundary at a time, so a shared "has the app mounted" flag would
 * let a boundary that is still hydrating render client-only state against
 * server markup that never had it.
 *
 * Replaces the `useEffect(() => setMounted(true), [])` idiom without the extra
 * commit that idiom costs.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * A value that only the browser can answer (`window.location`, `window.self
 * !== window.top`, `navigator.standalone`) and that does not change for the
 * life of the page. Renders `serverValue` on the server and while hydrating,
 * so the first client pass matches the HTML, then the real value.
 *
 * `read` must return the same primitive for the same page: it is compared by
 * identity, so return strings/booleans/numbers, never fresh objects.
 */
export function useClientValue<T extends string | number | boolean | null>(
  read: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(subscribeToNothing, read, () => serverValue);
}

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * `navigator.onLine`, kept current by the browser's online/offline events.
 * Optimistic by nature (a connected wifi with no route out still reports
 * online), so use it for UI shape only, never to decide whether a request
 * will succeed. Reports online on the server and during hydration.
 */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
}
