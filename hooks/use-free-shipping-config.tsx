"use client";

import { useEffect, useState } from "react";

type FreeShippingConfig = {
  /** `orders.freeShippingThreshold`. 0 when the store has none. */
  threshold: number;
  /** `shipping.enabled` — true when the store rates by zone instead. */
  zoneShippingEnabled: boolean;
};

const EMPTY_CONFIG: FreeShippingConfig = {
  threshold: 0,
  zoneShippingEnabled: false,
};

/**
 * The two settings the free-shipping nudge needs, for surfaces that do not
 * already fetch `/api/settings/public` themselves.
 *
 * `enabled` gates the request so the drawer only pays for it once the shopper
 * actually opens the bag, rather than on every page load. The response is cached
 * per mount; the threshold is admin config that does not change mid-session.
 */
export function useFreeShippingConfig(enabled: boolean): FreeShippingConfig {
  const [config, setConfig] = useState<FreeShippingConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/settings/public");
        const json = await res.json().catch(() => null);
        if (!active) return;

        if (res.ok && json?.success) {
          setConfig({
            threshold: Number(json.data?.orders?.freeShippingThreshold || 0),
            zoneShippingEnabled: Boolean(json.data?.shipping?.enabled),
          });
        }
      } catch {
        // Leave the config empty — the nudge stays hidden rather than
        // promising free shipping we could not confirm.
      } finally {
        if (active) setLoaded(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled, loaded]);

  return config;
}
