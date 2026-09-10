"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps an already-open storefront session fresh without sacrificing
 * navigation speed.
 *
 * Two gaps that server-side revalidation cannot reach (verified with a real
 * browser against the production build):
 *
 * 1. Back/forward navigation. The App Router restores those entries from the
 *    client Router Cache regardless of `staleTimes`, without any server
 *    request — a shopper who went home → product → back kept seeing the
 *    pre-mutation home page. `router.refresh()` after the restore refetches
 *    the current route's RSC payload in the background: the cached entry still
 *    paints instantly (scroll position and client state preserved), then fresh
 *    data streams in. The payload is answered by the full-route ISR cache, so
 *    the cost is one round trip, not a re-render from the database.
 *
 * 2. A tab left open in the background. Nothing re-renders it when the catalog
 *    changes, so on return the shopper could sit on hours-old content until
 *    they navigated. Refreshing on visibility regain — throttled, in the
 *    spirit of SWR/React Query's revalidate-on-focus — bounds that staleness
 *    at one cheap request per return.
 *
 * Normal link navigation is untouched: it already revalidates via
 * `staleTimes` (dynamic: 0, static: 30s), so this component adds zero requests
 * to the main browsing path.
 */
const FOCUS_REVALIDATE_INTERVAL_MS = 60_000;
const POPSTATE_COLLAPSE_MS = 1_000;

export function StorefrontRefresh() {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    const refresh = (minIntervalMs: number) => {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < minIntervalMs) return;
      lastRefreshAtRef.current = now;
      router.refresh();
    };

    // Queue behind the router's own popstate handling so the cached entry is
    // restored first (instant back), then revalidated.
    const onPopState = () => {
      setTimeout(() => refresh(POPSTATE_COLLAPSE_MS), 0);
    };

    // bfcache restore after a hard navigation away (e.g. an external payment
    // page) resurrects the full pre-navigation DOM; treat it like a back-nav.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh(POPSTATE_COLLAPSE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      refresh(FOCUS_REVALIDATE_INTERVAL_MS);
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
