"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { type Locale } from "@/config/i18n.config";
import { useState, useCallback, useMemo } from "react";
import type { StorefrontProductPriceRange } from "@/lib/products/storefront-product-filters";
import { FilterGroup } from "@/components/products/filter-group";
import { ProductFiltersLocation } from "@/components/products/product-filters-location";
import { ProductFiltersPickupFacet } from "@/components/products/product-filters-pickup-facet";
import {
  PICKUP_NEARBY_PARAM,
  hasLocationCoordinates,
  normalizeDistanceSortForLocation,
} from "@/lib/locations/shopper-location";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface FilterItem {
  name: string;
  slug: string;
}

export interface ProductFiltersProps {
  locale: Locale;
  categories: FilterItem[];
  collections: FilterItem[];
  currentCategory?: string;
  currentCollection?: string;
  currentMinPrice?: string;
  currentMaxPrice?: string;
  currentSort?: string;
  /**
   * Real price bounds of the products in scope. Falls back to the legacy
   * $0–1000 span only when the caller has no range to give.
   */
  priceRange?: StorefrontProductPriceRange | null;
  /**
   * Set false where sorting lives in a toolbar above the grid instead — sort is
   * not a filter, and users look for it next to the result count.
   */
  showSort?: boolean;
  /**
   * Products the current filters return, forwarded to the location group so a
   * shopper can see what their radius is costing them. Omitted where the caller
   * has not resolved a total.
   */
  resultCount?: number;
  /**
   * Whether shopper location features are switched on for this store
   * (`header.widgets.showLocationPicker`, the master switch).
   *
   * This group is where a shopper narrows *this listing* to a place. The
   * header's "Deliver to" is a different control for a different question —
   * where an order should go — and neither reads the other. Off by default,
   * matching the setting.
   */
  showLocation?: boolean;
  /**
   * Whether to offer the "Pickup near me" facet at all.
   *
   * Off wherever the store cannot actually complete a collected order —
   * collection is cash-at-the-counter, so a store with COD switched off has no
   * pickup option at checkout and the facet would be advertising a path that
   * does not exist. Off by default: a caller that has not thought about it
   * should not be promising collection.
   */
  showPickupFacet?: boolean;
  /**
   * Current value of the "Pickup near me" facet, straight from the URL.
   * Absent means "All sellers" — the facet has no value for its own default.
   */
  currentPickupNearby?: string;
}

const FALLBACK_PRICE_RANGE: StorefrontProductPriceRange = {
  min: 0,
  max: 1000,
  step: 10,
};
/**
 * How many options a taxonomy group lists before it defers to its own index
 * page. One number for both categories and collections: a sidebar where one
 * group stops at ten and the next runs to thirty reads as a bug, and the long
 * group pushes sort off the screen.
 */
const TAXONOMY_VISIBLE_LIMIT = 10;

/**
 * Show a filter group as soon as it has any option.
 *
 * A single-option group cannot narrow the current result set, but it still tells
 * a shopper what the store sells, and it is the control they look for when more
 * products arrive — so it stays visible.
 */
const MIN_USEFUL_OPTIONS = 1;

export function resolvePriceBounds(
  priceRange?: StorefrontProductPriceRange | null,
): StorefrontProductPriceRange {
  if (!priceRange) return FALLBACK_PRICE_RANGE;
  const step = priceRange.step > 0 ? priceRange.step : 1;
  return { min: priceRange.min, max: priceRange.max, step };
}

export function ProductFilters({
  locale,
  categories,
  collections,
  currentCategory,
  currentCollection,
  currentMinPrice,
  currentMaxPrice,
  currentSort = "popular",
  priceRange,
  showSort = true,
  resultCount,
  showLocation = false,
  showPickupFacet = false,
  currentPickupNearby,
}: ProductFiltersProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasCoordinates = hasLocationCoordinates(
    searchParams.get("lat"),
    searchParams.get("lng"),
  );
  const nearestLabel = t.has("location.nearestFirst")
    ? t("location.nearestFirst")
    : "Nearest";
  // Any value means on; only absence means "All sellers".
  const pickupNearby = Boolean(currentPickupNearby);
  const visibleSort = normalizeDistanceSortForLocation(
    currentSort,
    searchParams.get("lat"),
    searchParams.get("lng"),
  );

  // Parse comma-separated values from URL
  const selectedCategories = useMemo(
    () => (currentCategory ? currentCategory.split(",") : []),
    [currentCategory]
  );
  const selectedCollections = useMemo(
    () => (currentCollection ? currentCollection.split(",") : []),
    [currentCollection]
  );

  const bounds = useMemo(() => resolvePriceBounds(priceRange), [priceRange]);
  // Every product shares one price — the slider would be a dead control.
  const showPriceFilter = bounds.max > bounds.min;

  const clampPrice = useCallback(
    (value: number) => Math.min(bounds.max, Math.max(bounds.min, value)),
    [bounds.max, bounds.min]
  );

  const [priceValues, setPriceValues] = useState<[number, number]>([
    currentMinPrice ? clampPrice(parseInt(currentMinPrice)) : bounds.min,
    currentMaxPrice ? clampPrice(parseInt(currentMaxPrice)) : bounds.max,
  ]);

  // The URL is the source of truth: re-sync after navigation, and after the
  // bounds themselves change (a different vendor's store has a different span).
  useApplyOnChange(
    [currentMinPrice, currentMaxPrice, bounds.min, bounds.max, clampPrice],
    () => {
      setPriceValues([
        currentMinPrice ? clampPrice(parseInt(currentMinPrice)) : bounds.min,
        currentMaxPrice ? clampPrice(parseInt(currentMaxPrice)) : bounds.max,
      ]);
    },
  );

  const visibleCategories = useMemo(
    () => categories.slice(0, TAXONOMY_VISIBLE_LIMIT),
    [categories]
  );
  const hasMoreCategories = categories.length > TAXONOMY_VISIBLE_LIMIT;
  const visibleCollections = useMemo(
    () => collections.slice(0, TAXONOMY_VISIBLE_LIMIT),
    [collections]
  );
  const hasMoreCollections = collections.length > TAXONOMY_VISIBLE_LIMIT;
  const showCategories = categories.length >= MIN_USEFUL_OPTIONS;
  const showCollections = collections.length >= MIN_USEFUL_OPTIONS;

  const updateFilters = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });

      // Reset to page 1 when filters change
      params.delete("page");

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  // Toggle checkbox in a comma-separated list
  const toggleFilter = useCallback(
    (key: string, value: string, currentValues: string[]) => {
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];

      updateFilters({
        [key]: newValues.length > 0 ? newValues.join(",") : undefined,
      });
    },
    [updateFilters]
  );

  const handleSortChange = (value: string) => {
    updateFilters({ sortBy: value });
  };

  // A bound left at its edge is not a filter, so it is dropped from the URL
  // rather than pinned there as a no-op query param.
  const commitPrice = useCallback(
    (min: number, max: number) => {
      updateFilters({
        minPrice: min > bounds.min ? min.toString() : undefined,
        maxPrice: max < bounds.max ? max.toString() : undefined,
      });
    },
    [bounds.max, bounds.min, updateFilters]
  );

  const handlePriceChange = (values: number[]) => {
    setPriceValues([values[0], values[1]]);
  };

  const handlePriceCommit = (values: number[]) => {
    setPriceValues([values[0], values[1]]);
    commitPrice(values[0], values[1]);
  };

  const handleMinPriceInput = (value: number | undefined) => {
    if (value === undefined) return;
    const next = Math.min(priceValues[1], clampPrice(value));
    setPriceValues([next, priceValues[1]]);
    commitPrice(next, priceValues[1]);
  };

  const handleMaxPriceInput = (value: number | undefined) => {
    if (value === undefined) return;
    const next = Math.max(priceValues[0], clampPrice(value));
    setPriceValues([priceValues[0], next]);
    commitPrice(priceValues[0], next);
  };

  // A price bound moved off its edge is one active filter, however many of the
  // two the shopper dragged — the group narrows the grid once.
  const priceActive =
    (currentMinPrice !== undefined && Number(currentMinPrice) > bounds.min) ||
    (currentMaxPrice !== undefined && Number(currentMaxPrice) < bounds.max);

  const hasLocationValue =
    hasCoordinates || Boolean(searchParams.get("city")?.trim());

  /**
   * Filters "clear all" can actually undo.
   *
   * Location is deliberately outside this set: it is also held in a cookie and
   * in `localStorage`, so dropping only its URL params would leave the header
   * pill naming a place the grid no longer honours — and the next navigation
   * would put it straight back. The location group keeps its own Clear, which
   * writes through all three.
   */
  const clearableCount =
    selectedCategories.length +
    selectedCollections.length +
    (priceActive ? 1 : 0) +
    (pickupNearby ? 1 : 0);

  const clearFilters = useCallback(() => {
    updateFilters({
      category: undefined,
      collection: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      pickup: undefined,
    });
  }, [updateFilters]);

  const availabilityLabel = t.has("location.fulfillment")
    ? t("location.fulfillment")
    : "Availability";

  return (
    // `divide-y` draws the rule between whichever groups actually render, so a
    // store with no price spread or no collections can never leave a dangling
    // separator behind — the old hand-rolled `showX ? <Separator/> : null`
    // chain had to be re-derived every time a group was added.
    <div className="divide-y divide-border">
      {clearableCount > 0 ? (
        <div className="flex items-center justify-between gap-2 pb-3">
          <span className="text-xs text-muted-foreground">
            {t("productsPage.filters.activeCount", { count: clearableCount })}
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {t("common.clearAll")}
          </button>
        </div>
      ) : null}

      {/* Location, wherever shopper location is switched on. This group
          narrows the grid and lives in the URL; the header's "Deliver to" is
          a delivery address and touches nothing here. With the switch off
          there is nothing to set, so the group is not rendered at all. */}
      {showLocation ? (
        <FilterGroup
          id="location"
          title={t("location.title")}
          activeCount={hasLocationValue ? 1 : 0}
        >
          <ProductFiltersLocation
            resultCount={resultCount}
            narrowsResults={pickupNearby}
          />
        </FilterGroup>
      ) : null}

      {/* Collection facet. Only offered once there is a point to measure from:
          without one "near me" has no answer, and a control that empties the
          grid the moment it is touched is worse than an absent one. It rides
          with the location group because it is the same question — where are
          you — asked one step further. */}
      {showPickupFacet && hasCoordinates ? (
        <FilterGroup
          id="availability"
          title={availabilityLabel}
          activeCount={pickupNearby ? 1 : 0}
        >
          <ProductFiltersPickupFacet
            pickupNearby={pickupNearby}
            onChange={(next) =>
              updateFilters({ pickup: next ? PICKUP_NEARBY_PARAM : undefined })
            }
          />
        </FilterGroup>
      ) : null}

      {/* Price */}
      {showPriceFilter ? (
        <FilterGroup
          id="price"
          title={t("common.price")}
          activeCount={priceActive ? 1 : 0}
        >
          <div className="space-y-4">
            <Slider
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={priceValues}
              onValueChange={handlePriceChange}
              onValueCommit={handlePriceCommit}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("productsPage.filters.minPrice")}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <NumberInput
                    min={bounds.min}
                    max={priceValues[1]}
                    step={1}
                    value={priceValues[0]}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={handleMinPriceInput}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("productsPage.filters.maxPrice")}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <NumberInput
                    min={priceValues[0]}
                    max={bounds.max}
                    step={1}
                    value={priceValues[1]}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={handleMaxPriceInput}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
            </div>
          </div>
        </FilterGroup>
      ) : null}

      {/* Categories */}
      {showCategories ? (
        <FilterGroup
          id="categories"
          title={t("common.categories")}
          activeCount={selectedCategories.length}
        >
          <div className="space-y-2.5">
            {visibleCategories.map((cat) => (
              <label
                key={cat.slug}
                className="flex items-center gap-2.5 cursor-pointer"
              >
                <Checkbox
                  checked={selectedCategories.includes(cat.slug)}
                  onCheckedChange={() =>
                    toggleFilter("category", cat.slug, selectedCategories)
                  }
                />
                <span className="text-sm">{cat.name}</span>
              </label>
            ))}
            {hasMoreCategories ? (
              <Link
                href={`/${locale}/categories`}
                className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                {t("common.viewAll")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </FilterGroup>
      ) : null}

      {/* Collections */}
      {showCollections ? (
        <FilterGroup
          id="collections"
          title={t("nav.collections")}
          activeCount={selectedCollections.length}
        >
          <div className="space-y-2.5">
            {visibleCollections.map((col) => (
              <label
                key={col.slug}
                className="flex items-center gap-2.5 cursor-pointer"
              >
                <Checkbox
                  checked={selectedCollections.includes(col.slug)}
                  onCheckedChange={() =>
                    toggleFilter("collection", col.slug, selectedCollections)
                  }
                />
                <span className="text-sm">{col.name}</span>
              </label>
            ))}
            {hasMoreCollections ? (
              <Link
                href={`/${locale}/collections`}
                className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                {t("common.viewAll")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </FilterGroup>
      ) : null}

      {/* Sort By */}
      {showSort ? (
        <FilterGroup id="sort" title={t("product.sortBy")}>
          <RadioGroup value={visibleSort} onValueChange={handleSortChange}>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <RadioGroupItem value="popular" />
              <span className="text-sm">
                {t("productsPage.filters.sortOptions.mostPopular")}
              </span>
            </label>
            {hasCoordinates ? (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioGroupItem value="distance" />
                <span className="text-sm">{nearestLabel}</span>
              </label>
            ) : null}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <RadioGroupItem value="rating" />
              <span className="text-sm">
                {t("productsPage.filters.sortOptions.bestRating")}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <RadioGroupItem value="createdAt" />
              <span className="text-sm">
                {t("productsPage.filters.sortOptions.newest")}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <RadioGroupItem value="price-asc" />
              <span className="text-sm">
                {t("productsPage.filters.sortOptions.priceLowHigh")}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <RadioGroupItem value="price-desc" />
              <span className="text-sm">
                {t("productsPage.filters.sortOptions.priceHighLow")}
              </span>
            </label>
          </RadioGroup>
        </FilterGroup>
      ) : null}
    </div>
  );
}
