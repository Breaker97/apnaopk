"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RADIUS_KM,
  cityShopperLocation,
  hasLocationCoordinates,
  locationSearchParams,
  stripDistanceSortForLocation,
  stripPickupFacetForLocation,
  stripLocationParams,
  type ShopperLocation,
  roundShopperCoordinate,
} from "@/lib/locations/shopper-location";
import {
  clearRecentLocations,
  rememberRecentLocation,
} from "@/lib/locations/recent-locations";
import { useRadiusResultCounts } from "@/lib/locations/use-radius-result-counts";
import {
  EVERYWHERE_RADIUS_INDEX,
  RADIUS_STEPS_KM,
  indexFromRadius,
  normalizeRadiusKm,
  radiusFromIndex,
} from "@/lib/locations/vendor-geo";

type MarketplaceCity = {
  city: string;
  country?: string;
  vendorCount: number;
};

/** Long enough that a word typed at speed is one request. Matches `LocationPicker`. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * How many cities the sidebar lists.
 *
 * Smaller than the `LocationPicker` popover's eight: this list sits in a 240px
 * column above the price and category groups, and a long one pushes the rest
 * of the filters below the fold. Search is the way past it.
 */
const VISIBLE_CITY_COUNT = 5;

interface ProductFiltersLocationProps {
  /**
   * Products matching the filters the grid is currently rendering.
   *
   * Passed down from the server-rendered listing rather than fetched: the grid
   * already paid for this number, and re-deriving it on the client would be a
   * second query racing the one the shopper is looking at.
   */
  resultCount?: number;
  /**
   * Whether the location is currently cutting the catalogue down, which is true
   * only while the collection facet is on — a location by itself is a lens that
   * labels and orders without removing anything.
   *
   * The radius counts hang off this. Widening from 5 km to everywhere changes
   * no total while nothing is being narrowed, so seven identical numbers under
   * the slider would be seven requests spent teaching the shopper that the
   * control they are holding does nothing.
   */
  narrowsResults?: boolean;
}

/**
 * Location filter for the products sidebar.
 *
 * A full picker, not an echo: on the pages that carry the filter panel, this
 * group is how a shopper narrows the grid to a place at all. It offers the same
 * three ways in as the `LocationPicker` pill on the listings without a rail —
 * current location, city search, and the radius — and, like it, writes the URL
 * and only the URL. The filter is this listing's, and it ends with the URL.
 *
 * Radius needs a point to measure from, which only "use my current location"
 * supplies; a city names an area, not a spot inside it. The slider stays visible
 * but inert for a city so the capability is discoverable, with a line saying
 * what would switch it on.
 *
 * Rendered only where the store's location features are switched on; see
 * `ProductFilters`.
 */
export function ProductFiltersLocation({
  resultCount,
  narrowsResults = false,
}: ProductFiltersLocationProps = {}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<MarketplaceCity[]>([]);
  const [citiesLoaded, setCitiesLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const city = searchParams.get("city")?.trim() || "";
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radiusKm = normalizeRadiusKm(searchParams.get("radius"));
  const hasCoordinates = hasLocationCoordinates(lat, lng);

  const hasLocation = Boolean(city) || hasCoordinates;
  const label = city || (hasCoordinates ? t("location.nearMe") : "");

  const radiusIndex = useMemo(() => indexFromRadius(radiusKm), [radiusKm]);

  /**
   * The step under the shopper's thumb mid-drag.
   *
   * The slider is otherwise controlled by the URL, and the URL only changes on
   * release — so with no local value to follow, every drag frame re-rendered
   * the thumb back to where it started and the control simply would not move
   * under the mouse. (The keyboard hid this: each key press commits, so the URL
   * caught up before the next frame.)
   *
   * `null` means "not dragging — show what the URL says".
   */
  const [draft, setDraft] = useState<{ from: number; index: number } | null>(
    null,
  );

  // The draft records which committed step it was dragged away from. Once the
  // navigation lands, `radiusIndex` no longer matches `from` and the draft is
  // ignored — the URL becomes the source of truth again without an effect
  // clearing state on every commit.
  const shownIndex = draft?.from === radiusIndex ? draft.index : radiusIndex;
  const shownRadiusKm = radiusFromIndex(shownIndex);

  const {
    counts,
    loading: countsLoading,
    request: requestCounts,
  } = useRadiusResultCounts(searchParams, hasCoordinates && narrowsResults);

  /**
   * Remember the *place*, not the filter.
   *
   * The filter itself lives in the URL and nowhere else: it is this listing's
   * narrowing, and it ends when the shopper leaves. What is worth keeping is
   * the short list of places they reach for, which both this group and the
   * header's "Deliver to" panel offer as one-click rows.
   *
   * Deliberately not the location cookie. That holds the shopper's delivery
   * place, and someone filtering a category to Chittagong has not said to send
   * their order there.
   *
   * `remember` is off for a radius change: recents are a list of *places*, and
   * dragging the slider four steps is one place, not four visits.
   */
  const persist = useCallback(
    (next: ShopperLocation | null, { remember = true } = {}) => {
      if (next) {
        if (remember) rememberRecentLocation(next);
        return;
      }
      // Clearing a location is a shopper saying "not this place". Keeping the
      // history would put what they just dismissed straight back at the top of
      // the list. Matches `LocationPicker.commit`.
      clearRecentLocations();
    },
    [],
  );

  const commit = useCallback(
    (next: ShopperLocation | null) => {
      persist(next);

      const params = new URLSearchParams(searchParams.toString());
      stripLocationParams(params);
      for (const [key, value] of Object.entries(locationSearchParams(next))) {
        params.set(key, value);
      }
      // Distance ordering needs a point; without one it would silently fall
      // back and leave the sort control pointing at a hidden option.
      stripDistanceSortForLocation(params, next);
      stripPickupFacetForLocation(params, next);
      // A narrower location can leave the current page past the end of the
      // results, which reads as an empty store rather than a narrowed one.
      params.delete("page");

      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, persist, router, searchParams],
  );

  const applyRadius = useCallback(
    (index: number) => {
      if (index === radiusIndex) return;

      const params = new URLSearchParams(searchParams.toString());
      const next = radiusFromIndex(index);

      if (next === null) {
        params.delete("radius");
      } else {
        params.set("radius", String(next));
      }
      params.delete("page");

      // Keep the stored location's radius in step with the URL, so the
      // `LocationPicker` pill's subtitle does not contradict the slider that
      // just moved. Not a new visit, though — the place has not changed, only
      // how far around it the shopper is looking.
      if (hasCoordinates) {
        persist(
          {
            label: city || t("location.nearMe"),
            lat: Number(lat),
            lng: Number(lng),
            radiusKm: next,
            precise: !city,
          },
          { remember: false },
        );
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [
      city,
      hasCoordinates,
      lat,
      lng,
      pathname,
      persist,
      radiusIndex,
      router,
      searchParams,
      t,
    ],
  );

  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError(t("location.unsupported"));
      return;
    }

    setLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        commit({
          label: t("location.nearMe"),
          // Coarsened here, at the only point full-precision GPS enters the
          // app. See `roundShopperCoordinate`.
          lat: roundShopperCoordinate(position.coords.latitude),
          lng: roundShopperCoordinate(position.coords.longitude),
          // Keep whatever radius is already set; a shopper sharpening their
          // location has not asked to widen or narrow it. A city had none, so
          // fall back to the default rather than to "everywhere", which would
          // make the precise point they just gave pointless.
          radiusKm: radiusKm ?? DEFAULT_RADIUS_KM,
          precise: true,
        });
      },
      () => {
        // Denied, unavailable, or timed out — all the same to the shopper, who
        // just needs the city list instead.
        setLocating(false);
        setGeoError(t("location.permissionDenied"));
      },
      { timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  }, [commit, radiusKm, t]);

  // Cities are only fetched once the shopper actually types. The list is never
  // shown unsearched, so fetching it on hover would spend a request per visit
  // on rows nobody sees. Re-runs per keystroke because the endpoint returns a
  // capped page — the city they want may simply not be in the first one.
  const needle = query.trim();

  useEffect(() => {
    if (!needle) return;

    // The first fetch has nothing on screen yet, so it runs immediately;
    // keystrokes wait out the debounce against a list already rendered.
    const delay = citiesLoaded ? SEARCH_DEBOUNCE_MS : 0;

    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const response = await fetch(
            `/api/locations/cities?q=${encodeURIComponent(needle)}`,
          );
          if (!response.ok) return;

          const payload = await response.json();
          if (cancelled) return;

          const rows = payload?.data?.cities;
          if (Array.isArray(rows)) setCities(rows);
        } catch {
          // Offline or a failed request: the last good list stays on screen and
          // is filtered locally, so the picker degrades instead of emptying.
        } finally {
          if (!cancelled) setCitiesLoaded(true);
        }
      })();
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `citiesLoaded` is read for the first-fetch delay but deliberately not a
    // dependency: it flips on the first response and would re-fire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle]);

  const searching = needle.length > 0;

  // The server has already applied the query; re-applying it locally narrows
  // the list on the keystroke instead of waiting out the debounce, and leaves a
  // failed request showing a filtered list rather than a stale unfiltered one.
  const visibleCities = useMemo(() => {
    const lowered = needle.toLowerCase();
    return cities
      .filter((entry) => entry.city.toLowerCase().includes(lowered))
      .slice(0, VISIBLE_CITY_COUNT);
  }, [cities, needle]);

  // Keyed on the dragged step: the point of the count is to answer "what would
  // this radius give me?" before the shopper lets go.
  const activeCount = counts[shownIndex];

  return (
    <div className="space-y-3">
      {/* The group's title and its collapse control belong to the surrounding
          <FilterGroup>; "clear" rides with the place it clears instead, where
          it is still reachable from a collapsed group's badge. */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <MapPin
            className={cn(
              "h-4 w-4 shrink-0",
              hasLocation ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              "truncate",
              hasLocation ? "font-medium" : "text-muted-foreground",
            )}
          >
            {hasLocation ? label : t("location.allLocations")}
          </span>
        </span>
        {hasLocation ? (
          <button
            type="button"
            onClick={() => commit(null)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {t("location.clear")}
          </button>
        ) : null}
      </div>

      {/* What the current filters actually return. Rendered from the grid's
          own total so the two can never disagree. */}
      {typeof resultCount === "number" ? (
        <p className="text-xs text-muted-foreground">
          {t("location.resultCount", { count: resultCount })}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={useCurrentLocation}
        disabled={locating}
        className="h-8 w-full justify-start gap-2 text-xs"
      >
        {locating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {t("location.useMyLocation")}
      </Button>

      {geoError ? (
        <p className="text-[11px] text-muted-foreground">{geoError}</p>
      ) : null}

      <div className="space-y-1.5">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("location.searchCity")}
            aria-label={t("location.searchCity")}
            className="h-8 pl-7 text-xs"
          />
        </div>

        {/* Only while searching. A list that hangs open under the box adds
            five rows to a 240px column for every shopper, pushing price and
            categories below the fold to answer a question most of them never
            asked. Typing is the way in; the `LocationPicker` popover is where
            browsing a full city list belongs. */}
        {searching ? (
          <div className="space-y-0.5">
            {!citiesLoaded ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">
                {t("common.loading")}
              </p>
            ) : visibleCities.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">
                {t("location.noCities")}
              </p>
            ) : (
              visibleCities.map((entry) => {
                const active =
                  city.toLowerCase() === entry.city.toLowerCase();

                return (
                  <button
                    key={entry.city}
                    type="button"
                    onClick={() => {
                      const next = cityShopperLocation(entry.city);
                      if (next) commit(next);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
                      active && "bg-accent font-medium",
                    )}
                  >
                    <span className="truncate">
                      {entry.city}
                      {entry.country ? (
                        <span className="text-muted-foreground">
                          , {entry.country}
                        </span>
                      ) : null}
                    </span>
                    {/* The store count sets expectations before the shopper
                        commits, rather than after an empty grid. */}
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entry.vendorCount}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <div
        className="space-y-2 pt-1"
        onPointerEnter={requestCounts}
        onFocusCapture={requestCounts}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">
            {t("location.radius")}
          </span>
          <span
            className={cn(
              "text-xs font-semibold",
              !hasCoordinates && "text-muted-foreground",
            )}
          >
            {/* Reads from the dragged step, not the committed one, so the
                number tracks the thumb instead of lagging a navigation
                behind it. */}
            {shownRadiusKm === null || !hasCoordinates
              ? t("location.everywhere")
              : t("location.withinKm", { km: shownRadiusKm })}
          </span>
        </div>

        {/* Inert without a point to measure from — a city names an area, and
            a 5 km radius from an arbitrary spot inside it would be a lie.
            Visible rather than hidden so the capability is discoverable, with
            the line below saying exactly what switches it on. */}
        <Slider
          min={0}
          max={EVERYWHERE_RADIUS_INDEX}
          step={1}
          value={[hasCoordinates ? shownIndex : EVERYWHERE_RADIUS_INDEX]}
          // Follow the drag locally, navigate only on release: committing on
          // every tick would fire a navigation per pixel of travel.
          onValueChange={(values) =>
            setDraft({ from: radiusIndex, index: values[0] })
          }
          onValueCommit={(values) => applyRadius(values[0])}
          disabled={!hasCoordinates}
          aria-label={t("location.radius")}
          className={cn(
            !hasCoordinates &&
              "[&_[data-slot=slider-range]]:bg-muted-foreground/30 [&_[data-slot=slider-thumb]]:border-muted-foreground/40",
          )}
        />

        {/* Ticks, so the discrete steps behind the track are visible and the
            shopper can see which stop they are dragging toward. */}
        <div
          aria-hidden="true"
          className="flex justify-between px-0.5 text-[10px] text-muted-foreground"
        >
          {[...RADIUS_STEPS_KM, null].map((km, index) => (
            <span
              key={km ?? "everywhere"}
              className={cn(
                hasCoordinates &&
                  index === shownIndex &&
                  "font-semibold text-foreground",
              )}
            >
              {km ?? t("location.anyDistance")}
            </span>
          ))}
        </div>

        {!hasCoordinates ? (
          <p className="text-[11px] text-muted-foreground">
            {t("location.radiusNeedsPoint")}
          </p>
        ) : !narrowsResults ? (
          // The radius is real but it is not removing anything: it decides how
          // far "collect nearby" reaches and how the nearest-first sort ranks,
          // while the grid stays countrywide. Said plainly, because a slider
          // that visibly moves and changes no total otherwise reads as broken.
          <p className="text-[11px] text-muted-foreground">
            {t.has("location.radiusAffectsPickupOnly")
              ? t("location.radiusAffectsPickupOnly")
              : "Sets how far collection and distances are measured. All products stay listed."}
          </p>
        ) : countsLoading ? (
          // What the chosen step returns, once counted. The slider commits on
          // release, so this is the shopper's only preview of the result of a
          // drag they have not made yet.
          <p className="text-[11px] text-muted-foreground">
            {t("location.resultCountLoading")}
          </p>
        ) : typeof activeCount === "number" ? (
          <p className="text-[11px] text-muted-foreground">
            {t("location.resultCount", { count: activeCount })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
