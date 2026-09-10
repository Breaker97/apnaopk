"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether `query` currently matches, kept in step with the browser's own
 * `change` events. `false` on the server and during hydration, so the first
 * client pass matches the HTML.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
