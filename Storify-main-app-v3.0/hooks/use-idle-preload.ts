"use client";

import { useEffect, useMemo } from "react";

const IDLE_TIMEOUT_MS = 5_000;
/** Where the browser has no `requestIdleCallback` (Safari before 18.2). */
const IDLE_FALLBACK_MS = 2_000;

/**
 * Runs `run` once the page is idle — or after a few seconds, busy or not.
 * `run` keeps its identity across renders (module-level or `useCallback`);
 * `null` runs nothing.
 */
export function useWhenIdle(run: (() => void) | null) {
  useEffect(() => {
    if (!run) return;
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(run, IDLE_FALLBACK_MS);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }, [run]);
}

/**
 * Starts downloading a module that was split out of the first load once the
 * page is idle, so it is there before the shopper asks for it: the split keeps
 * it off the path to an interactive page, not off the network. `load` is a
 * module-level `() => import(...)` of the module the `dynamic()` imports;
 * `null` when this page will not need it.
 */
export function useIdlePreload(load: (() => Promise<unknown>) | null) {
  // A failed download is retried by the `dynamic()` when it renders.
  const run = useMemo(
    () => (load ? () => void load().catch(() => undefined) : null),
    [load],
  );
  useWhenIdle(run);
}
