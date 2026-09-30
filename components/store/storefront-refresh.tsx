"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";

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
 *    data streams in.
 *
 * 2. A tab left open in the background. Nothing re-renders it when the catalog
 *    changes, so on return the shopper could sit on hours-old content until
 *    they navigated. Refreshing on visibility regain bounds that staleness, in
 *    the spirit of SWR/React Query's revalidate-on-focus.
 *
 * A refresh is not cheap. Storefront pages are rendered per request — there is
 * no full-route cache to answer it — so each one is a server render and the
 * page's whole payload again: ~360 KB for the home page, on every Back. So
 * only a page old enough to have gone stale is refreshed: one the server drew
 * more than `BACK_STALE_AFTER_MS` ago on back/forward, `FOCUS_STALE_AFTER_MS`
 * on refocus. A shopper bouncing between the home page and products gets the
 * page they just left, as a browser's own Back would show it. A page restored
 * from the browser's back/forward cache is always refreshed: the shopper went
 * to another site (a payment page, say) and anything may have happened
 * meanwhile.
 *
 * Normal link navigation is untouched: it already revalidates via
 * `staleTimes` (dynamic: 0, static: 30s), so this component adds zero requests
 * to the main browsing path.
 */
const BACK_STALE_AFTER_MS = 30_000;
const FOCUS_STALE_AFTER_MS = 60_000;
/** Back pressed several times in a row refreshes only where the shopper stops. */
const POPSTATE_SETTLE_MS = 300;

/** The server draws an address the same whatever its fragment. */
function currentPage() {
  return window.location.href.split("#")[0];
}

export function StorefrontRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  // When the server last drew each page this tab has shown.
  const drawnAtRef = useRef(new Map<string, number>());
  // Pages a back/forward is restoring from the Router Cache: shown, but not
  // drawn again.
  const restoringRef = useRef(new Set<string>());

  useEffect(() => {
    const page = currentPage();
    if (restoringRef.current.delete(page)) return;
    drawnAtRef.current.set(page, Date.now());
  }, [pathname]);

  useEffect(() => {
    const drawnAt = drawnAtRef.current;
    let settleTimer: number | undefined;

    const refresh = () => {
      drawnAt.set(currentPage(), Date.now());
      router.refresh();
    };

    const refreshIfOlderThan = (maxAgeMs: number) => {
      const at = drawnAt.get(currentPage());
      if (at !== undefined && Date.now() - at < maxAgeMs) return;
      refresh();
    };

    // Queue behind the router's own popstate handling so the cached entry is
    // restored first (instant back), then revalidated.
    const onPopState = () => {
      restoringRef.current.add(currentPage());
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(
        () => refreshIfOlderThan(BACK_STALE_AFTER_MS),
        POPSTATE_SETTLE_MS,
      );
    };

    // bfcache restore after a hard navigation away (e.g. an external payment
    // page) resurrects the full pre-navigation DOM.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      refreshIfOlderThan(FOCUS_STALE_AFTER_MS);
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
