"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";

/** A location as Settings → Point of Sale reads it: its name, and whether a register may stand there. */
export interface POSLocationChoice {
  _id: string;
  name: string;
  isDefault?: boolean;
  isActive?: boolean;
  sellsAtCounter?: boolean;
}

/** The store's locations; `null` until they arrive, `"failed"` when the request failed. */
export type POSLocationList = POSLocationChoice[] | "failed" | null;

/**
 * The store's locations, for the default counter on Settings → Point of Sale.
 * Asked for only while `wanted` (the page shows no counter while POS is off).
 *
 * Closed branches come too: the saved counter may be one of them, and the
 * page then names it rather than saying it no longer exists.
 */
export function usePOSLocations(wanted: boolean): POSLocationList {
  const [locations, setLocations] = useState<POSLocationList>(null);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    apiClient
      .get<POSLocationChoice[]>("/api/admin/locations", {
        query: { includeInactive: true },
      })
      .then((data) => {
        if (!cancelled) setLocations(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setLocations("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return wanted ? locations : null;
}
