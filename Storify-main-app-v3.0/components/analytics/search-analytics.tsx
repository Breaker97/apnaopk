"use client";

import { useEffect } from "react";
import { trackSearch } from "@/lib/analytics/events";

export function SearchAnalytics({ query }: { query?: string }) {
  useEffect(() => {
    const term = query?.trim();
    if (!term) return;

    trackSearch(term);
  }, [query]);

  return null;
}
