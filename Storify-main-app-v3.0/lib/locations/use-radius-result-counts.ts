"use client";

/**
 * Product counts for each offered radius, so the radius control can say what
 * widening or narrowing would actually do.
 *
 * Without this the shopper is guessing: every step looks identical until they
 * commit to one and the grid reloads, and the common disappointment — narrowing
 * to 5 km and landing on an empty store — is only discoverable by doing it.
 *
 * Counts come from `/api/products` with `limit=1`, which is the cheapest way to
 * reach `pagination.total` for a filter set. That is one request per step, so
 * they are fetched lazily, in one batch, and only once per filter set.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EVERYWHERE_RADIUS_INDEX,
  RADIUS_STEPS_KM,
  radiusFromIndex,
} from "@/lib/locations/vendor-geo";

/**
 * Params that change which products are counted.
 *
 * `radius` is deliberately absent — it is what varies per count — and so are
 * `page` and `sortBy`, which reorder or window the same set and would only
 * fragment the cache. Everything else must be carried, or the sidebar would
 * promise 400 products for a radius while the category-filtered grid shows 3.
 *
 * This list has to track every filter `/api/products` narrows on: a param the
 * grid applies but the count omits is counted against a *wider* catalogue, so
 * the sidebar overstates. Kept in the same order as the route reads them so the
 * two are easy to diff by eye.
 */
const COUNTED_PARAMS = [
  "lat",
  "lng",
  "city",
  "pickup",
  "category",
  "collection",
  "brand",
  "search",
  "minPrice",
  "maxPrice",
  "vendor",
  "tag",
  "onSale",
  "inStock",
  "minRating",
  "featured",
  "preorder",
  "ids",
] as const;

/** Counts keyed by step index; `undefined` where the count is not in yet. */
type RadiusResultCounts = Record<number, number | undefined>;

/**
 * Identity of a filter set, so counts are refetched when the shopper changes a
 * category but not when they merely page through results.
 */
export function radiusCountKey(params: URLSearchParams): string {
  return COUNTED_PARAMS.map(
    (key) => `${key}=${params.get(key)?.trim() ?? ""}`,
  ).join("&");
}

/**
 * The count request for one radius step.
 *
 * Comma-joined `category`/`collection` values are forwarded as-is: the query
 * layer splits them on commas, so a multi-select filter counts against the same
 * set the grid renders rather than against a slug named "shoes,bags".
 */
export function radiusCountUrl(
  params: URLSearchParams,
  radiusKm: number | null,
): string {
  const query = new URLSearchParams();

  for (const key of COUNTED_PARAMS) {
    const value = params.get(key)?.trim();
    if (value) query.set(key, value);
  }

  if (radiusKm !== null) query.set("radius", String(radiusKm));
  // One document is the smallest page the route will build a total for; the
  // count itself costs the same either way.
  query.set("limit", "1");
  query.set("cardFieldsOnly", "true");

  return `/api/products?${query.toString()}`;
}

/**
 * Fetch a total per radius step for the current filters.
 *
 * `enabled` is false for a city-only location: with no point to measure from,
 * no radius applies and every step would return the same number.
 */
export function useRadiusResultCounts(
  searchParams: URLSearchParams,
  enabled: boolean,
): {
  counts: RadiusResultCounts;
  loading: boolean;
  /** Call to start counting. Cheap to call repeatedly; only the first counts. */
  request: () => void;
} {
  const key = radiusCountKey(searchParams);

  /**
   * Counts carry the filter set they were fetched for.
   *
   * Tagging them is what makes a stale set detectable by comparison during
   * render: the alternative is clearing them from an effect, which paints one
   * frame of the previous category's numbers under the new category's grid.
   */
  const [result, setResult] = useState<{
    key: string;
    counts: RadiusResultCounts;
  } | null>(null);

  // The filter set the shopper has asked for counts on. Also tagged, so a
  // filter change withdraws the request rather than counting the old set.
  const [requestedKey, setRequestedKey] = useState<string | null>(null);

  const request = useCallback(() => setRequestedKey(key), [key]);

  const active = enabled && requestedKey === key;

  // The URLs to fetch, derived from the same params the key is built from.
  // Memoized on the key rather than on the params object, which is a fresh
  // instance every render and would re-fire the effect on each one.
  const urls = useMemo(
    () =>
      [...RADIUS_STEPS_KM.keys(), EVERYWHERE_RADIUS_INDEX].map((index) => ({
        index,
        url: radiusCountUrl(searchParams, radiusFromIndex(index)),
      })),
    // `key` covers every param `radiusCountUrl` reads; see COUNTED_PARAMS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    // One batch is seven requests. Without this a shopper flicking between
    // categories leaves every previous batch in flight — the results were
    // already ignored, but the requests still ran, and each one costs a full
    // location resolve on an anonymous endpoint.
    const controller = new AbortController();

    (async () => {
      const settled = await Promise.all(
        urls.map(async ({ index, url }) => {
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) return [index, undefined] as const;

            // `paginatedResponse` nests the page under the success envelope,
            // so the total lives at data.pagination, not at the root.
            const payload = await response.json();
            const total = payload?.data?.pagination?.total;
            return [
              index,
              typeof total === "number" ? total : undefined,
            ] as const;
          } catch {
            // Offline, rate-limited, or aborted. A missing count renders as no
            // count at all, which is what the control shows before any arrive —
            // the radius itself still works.
            return [index, undefined] as const;
          }
        }),
      );

      if (cancelled) return;

      setResult({ key, counts: Object.fromEntries(settled) });
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, key, urls]);

  // Counts fetched for a filter set the shopper has since changed describe a
  // different catalogue, so they are dropped rather than shown against it.
  const fresh = result?.key === key;

  return {
    counts: fresh ? result.counts : {},
    // Requested but not yet answered for *this* filter set — which covers both
    // the first fetch and a refetch after the shopper changed a filter.
    loading: active && !fresh,
    request,
  };
}
