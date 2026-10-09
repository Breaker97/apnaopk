"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { BoostingOverview } from "@/lib/boosts/boosting-overview";

/**
 * The ladder, the pages' depths and the live bookings, for Settings → Product
 * Boosting. Asked for only while `wanted` (boosting is a multi-vendor
 * feature; a store without vendors shows none of it).
 *
 * Null until it arrives, and it stays null when the request fails: the page
 * works without it, it only loses the ladder line and the warnings that need
 * the ladder.
 */
export function useBoostingOverview(wanted: boolean): BoostingOverview | null {
  const [overview, setOverview] = useState<BoostingOverview | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    apiClient
      .get<BoostingOverview>("/api/admin/boosts/overview")
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        // Left null on purpose; see above.
      });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return wanted ? overview : null;
}
