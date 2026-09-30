"use client";

import { Suspense, type ReactNode } from "react";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * A Suspense boundary for content that loads in the browser.
 *
 * Its children read with `useSuspenseResource`, which fetches relative `/api`
 * urls and so cannot run in the server render. The server — and hydration,
 * which has to match it — therefore draws the fallback itself. The children
 * mount right after and suspend on their data, keeping that same fallback up
 * until it lands.
 *
 * On a client-side navigation there is no hydration: the children render
 * straight away, and an answer the cache already holds shows with no fallback
 * at all — which is the point of caching it.
 */
export function ClientSuspense({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  return (
    <Suspense fallback={fallback}>{hydrated ? children : fallback}</Suspense>
  );
}
