"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Guarantees a push/replace navigation lands at the top of the new page.
 *
 * Next's built-in scroll reset fires once, when the destination segment first
 * mounts. On a slow connection that mount is the route's loading fallback (or
 * happens while the old, longer document still sets the scroll bounds), so the
 * reset is consumed before the real page streams in — the shopper then lands
 * clamped to the bottom of the new, shorter page (home → "Go to Shop" showed
 * the vendor page's footer). This re-applies the reset when the pathname
 * actually commits.
 *
 * Deliberately inert for:
 * - back/forward traversals, so the browser's scroll restoration still
 *   returns the shopper to where they were;
 * - same-pathname navigations (tab/filter/compare links that only change the
 *   query string, several of which pass scroll={false} on purpose);
 * - hash navigations, which target an in-page anchor.
 */
export function ScrollResetOnNavigate() {
  const pathname = usePathname();
  const isTraversal = useRef(false);
  const lastPathname = useRef(pathname);

  useEffect(() => {
    const markTraversal = () => {
      isTraversal.current = true;
    };
    window.addEventListener("popstate", markTraversal);
    return () => window.removeEventListener("popstate", markTraversal);
  }, []);

  useEffect(() => {
    if (pathname === lastPathname.current) return;
    lastPathname.current = pathname;
    const traversal = isTraversal.current;
    isTraversal.current = false;
    if (traversal || window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
