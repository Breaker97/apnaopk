"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "@/hooks/use-locale-navigation";

const START_EVENT = "storify:navigation-start";

/** How long a bar may run before it is taken down as a navigation that never landed. */
const FAILSAFE_MS = 10_000;

/**
 * Announces that an in-app navigation has started. The Link wrapper calls it
 * from `onNavigate`, which fires only for a real client-side navigation — not
 * for a new tab, a modifier click or a link whose own handler cancelled it.
 */
export function startNavigationProgress(): void {
  window.dispatchEvent(new Event(START_EVENT));
}

/**
 * A thin bar across the top of the page from the tap until the next page
 * commits.
 *
 * Links prefetch on intent now (components/language/link.tsx), and on a phone
 * the touch that starts the prefetch comes a moment before the tap, so the
 * next page's loading skeleton is not ready when the finger lifts. Nothing on
 * screen changed until the server answered — one round trip, which for a
 * shopper far from the server is where a store "freezes". The bar answers the
 * tap in the same frame.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const routeKey = `${pathname}?${search}`;

  // The route the navigation started from; null while nothing is running.
  const [startedOn, setStartedOn] = useState<string | null>(null);
  const currentRoute = useRef(routeKey);

  useEffect(() => {
    currentRoute.current = routeKey;
  }, [routeKey]);

  useEffect(() => {
    const start = () => setStartedOn(currentRoute.current);
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
  }, []);

  const running = startedOn !== null && startedOn === routeKey;
  const done = startedOn !== null && startedOn !== routeKey;

  // Fill, fade, then leave the page.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setStartedOn(null), 400);
    return () => clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setStartedOn(null), FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, [running]);

  if (startedOn === null) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
    >
      <div
        data-navigation-progress={done ? "done" : "running"}
        className="h-full w-full bg-primary"
      />
    </div>
  );
}
