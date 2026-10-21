"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { POSProduct } from "@/components/pos/pos-types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * The till's quick keys (Favourites): read from the server while online,
 * remembered on the device so the tab still works offline — where the
 * products come from the offline snapshot when it has them, so their stock
 * is the snapshot's, not the last online read's.
 */

const CACHE_KEY = "pos:quick-keys";

type Cached = { productIds: string[]; products: POSProduct[] };

function readCache(scope: string): Cached | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY}:${scope}`);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function writeCache(scope: string, value: Cached) {
  try {
    window.localStorage.setItem(`${CACHE_KEY}:${scope}`, JSON.stringify(value));
  } catch {
    // Storage blocked: the tab still works online.
  }
}

export interface POSQuickKeysState {
  products: POSProduct[];
  isFavourite: (productId: string) => boolean;
  canEdit: boolean;
  toggle: (product: POSProduct) => Promise<void>;
  saving: boolean;
}

export function usePOSQuickKeys(params: {
  locationId?: string;
  isOffline: boolean;
  offlineProducts: POSProduct[];
}): POSQuickKeysState {
  const { locationId, isOffline, offlineProducts } = params;
  const scope = locationId || "default";
  const [state, setState] = useState<Cached & { canEdit: boolean }>({ productIds: [], products: [], canEdit: false });
  const [saving, setSaving] = useState(false);

  const hydrated = useHydrated();
  useApplyOnChange([scope, hydrated], () => {
    if (!hydrated) return;
    const cached = readCache(scope);
    if (cached) setState((prev) => ({ ...prev, ...cached }));
  });

  useEffect(() => {
    if (isOffline) return;
    const controller = new AbortController();
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    fetch(`/api/pos/quick-keys${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json?.success) return;
        const next = {
          productIds: (json.data.productIds ?? []) as string[],
          products: (json.data.products ?? []) as POSProduct[],
        };
        writeCache(scope, next);
        setState({ ...next, canEdit: Boolean(json.data.canEdit) });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isOffline, locationId, scope]);

  const products = useMemo(() => {
    if (!isOffline) return state.products;
    const snapshot = new Map(offlineProducts.map((product) => [String(product._id), product]));
    const cached = new Map(state.products.map((product) => [String(product._id), product]));
    return state.productIds
      .map((id) => snapshot.get(id) ?? cached.get(id))
      .filter((product): product is POSProduct => Boolean(product));
  }, [isOffline, offlineProducts, state.productIds, state.products]);

  const isFavourite = useCallback((productId: string) => state.productIds.includes(productId), [state.productIds]);

  const toggle = useCallback(
    async (product: POSProduct) => {
      const id = String(product._id);
      const previous = state;
      const productIds = previous.productIds.includes(id)
        ? previous.productIds.filter((candidate) => candidate !== id)
        : [...previous.productIds, id];
      const next = {
        ...previous,
        productIds,
        products: productIds
          .map((candidate) =>
            candidate === id ? product : previous.products.find((row) => String(row._id) === candidate),
          )
          .filter((row): row is POSProduct => Boolean(row)),
      };
      setState(next);
      setSaving(true);
      try {
        const res = await fetch("/api/pos/quick-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || "Quick keys were not saved");
        writeCache(scope, { productIds: next.productIds, products: next.products });
      } catch (error) {
        setState(previous);
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [scope, state],
  );

  return { products, isFavourite, canEdit: state.canEdit && !isOffline, toggle, saving };
}
