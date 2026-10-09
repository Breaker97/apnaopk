"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * When the page was rendered, for the few things the storefront draws from
 * the clock: whether a pre-order is still open, whether a countdown offer has
 * run out, the footer's year.
 *
 * A cached page (the home page, a product page) is hydrated long after it was
 * rendered — up to its revalidate period, and on a quiet page the first visit
 * after that. A component reading the browser's clock while it hydrates can
 * then draw something the HTML does not have, and React throws the server's
 * markup for that part away and draws it again. Hydrating against the
 * render's own time keeps the first client pass identical to the HTML; the
 * browser's clock takes over on the render right after.
 */
const RenderClockContext = createContext<number | null>(null);

export function RenderClockProvider({
  at,
  children,
}: {
  /** `Date.now()` of the server render the HTML comes from. */
  at: number;
  children: ReactNode;
}) {
  return (
    <RenderClockContext.Provider value={at}>{children}</RenderClockContext.Provider>
  );
}

/**
 * "Now", for a decision drawn into the page: the server's render time on the
 * server and while this component hydrates, then the browser's time from when
 * it mounted. Without a provider — a back-office preview, rendered per
 * request — the time it mounted, on either side.
 */
export function useRenderNow(): number {
  const renderedAt = useContext(RenderClockContext);
  const hydrated = useHydrated();
  const [mountedAt] = useState(() => Date.now());
  return hydrated || renderedAt === null ? mountedAt : renderedAt;
}
