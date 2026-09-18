"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/number-input";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ProductFiltersLocation } from "@/components/products/product-filters-location";
import { ProductFiltersPickupFacet } from "@/components/products/product-filters-pickup-facet";
import { ProductsMobileToolbar } from "@/components/products/products-mobile-toolbar";
import { type Locale } from "@/config/i18n.config";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import {
  PICKUP_NEARBY_PARAM,
  hasLocationCoordinates,
} from "@/lib/locations/shopper-location";
import type { StorefrontProductPriceRange } from "@/lib/products/storefront-product-filters";
import { useCurrency } from "@/providers/currency-provider";

export interface FilterOption {
  name: string;
  slug: string;
}

/**
 * The shopper-location inputs every listing rail takes, so the products page
 * and a category page cannot drift into offering different controls.
 */
interface LocationFilterProps {
  /**
   * Whether shopper location is switched on for this store
   * (`header.widgets.showLocationPicker`). This group is where a shopper sets
   * a location from the listing; the header's "Deliver to" is the other way
   * in, and both write through the same storage.
   */
  showLocation?: boolean;
  /** Whether to offer the "Pickup near me" facet; needs a point to measure from. */
  showPickupFacet?: boolean;
  /** Current value of the facet, straight from the URL. Absent means "All". */
  currentPickupNearby?: string;
  /** Products the current filters return, for the location group's count. */
  resultCount?: number;
}

interface ListingFiltersProps extends LocationFilterProps {
  locale: Locale;
  /**
   * The categories to filter by: the whole store's on the products page, or
   * one branch's children on a category page. Empty hides the group.
   */
  categories: FilterOption[];
  /**
   * Where "View all" leads once the category list is capped. The products
   * page links its index; a category page lists every child and passes none.
   */
  categoriesIndexHref?: string;
  /** Collections to filter by. Absent or empty hides the group. */
  collections?: FilterOption[];
  brands: FilterOption[];
  priceRange: StorefrontProductPriceRange | null;
  currentCategories?: string;
  currentCollections?: string;
  currentStock?: string;
  currentBrands?: string;
  currentMinPrice?: string;
  currentMaxPrice?: string;
  /** False once the platform hides sold-out products — see the facet below. */
  showStockFacet?: boolean;
}

/**
 * Options listed before a taxonomy group defers to its own index page, so no
 * group can push the featured strip off the screen.
 */
const CATEGORIES_VISIBLE_LIMIT = 10;
const COLLECTIONS_VISIBLE_LIMIT = 8;
const BRANDS_VISIBLE_LIMIT = 8;

/** The facet counts as one active filter whenever it carries any value. */
function countActivePickupFacet(currentPickupNearby?: string): number {
  return currentPickupNearby ? 1 : 0;
}

function splitParam(value?: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * The storefront's listing filter rail — the products page and every category
 * page, under every template. Location, category, collection, availability,
 * price and brand facets in a flat checklist; each template draws the page
 * around it, but no template offers a filter the others lack.
 *
 * State lives entirely in the URL (`category`, `collection`, `stock`,
 * `brand`, `minPrice`/`maxPrice`, `pickup`) — the same params the grid and its
 * page links carry, so a filtered page 2 is shareable and the back button
 * undoes one choice at a time.
 */
export function ListingFilters({
  locale,
  categories,
  categoriesIndexHref,
  collections = [],
  brands,
  priceRange,
  currentCategories,
  currentCollections,
  currentStock,
  currentBrands,
  currentMinPrice,
  currentMaxPrice,
  showStockFacet = true,
  showLocation = false,
  showPickupFacet = false,
  currentPickupNearby,
  resultCount,
}: ListingFiltersProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currency, formatPrice } = useCurrency();
  // Any value means on; only absence means "All sellers".
  const pickupNearby = Boolean(currentPickupNearby);

  const selectedCategories = useMemo(
    () => splitParam(currentCategories),
    [currentCategories],
  );
  const selectedCollections = useMemo(
    () => splitParam(currentCollections),
    [currentCollections],
  );
  const selectedStock = useMemo(() => splitParam(currentStock), [currentStock]);
  const selectedBrands = useMemo(() => splitParam(currentBrands), [currentBrands]);

  const bounds =
    priceRange && priceRange.max > priceRange.min ? priceRange : null;

  const clampPrice = useCallback(
    (value: number) =>
      bounds ? Math.min(bounds.max, Math.max(bounds.min, value)) : value,
    [bounds],
  );

  const [priceValues, setPriceValues] = useState<[number, number]>([
    currentMinPrice && bounds
      ? clampPrice(parseInt(currentMinPrice))
      : (bounds?.min ?? 0),
    currentMaxPrice && bounds
      ? clampPrice(parseInt(currentMaxPrice))
      : (bounds?.max ?? 0),
  ]);

  // The URL is the source of truth: re-sync after navigation.
  useApplyOnChange([bounds, clampPrice, currentMinPrice, currentMaxPrice], () => {
    if (!bounds) return;
    setPriceValues([
      currentMinPrice ? clampPrice(parseInt(currentMinPrice)) : bounds.min,
      currentMaxPrice ? clampPrice(parseInt(currentMaxPrice)) : bounds.max,
    ]);
  });

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
      params.delete("page");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const toggleValue = useCallback(
    (key: string, value: string, current: string[]) => {
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
      updateFilters({ [key]: next.length > 0 ? next.join(",") : undefined });
    },
    [updateFilters],
  );

  const commitPrice = useCallback(
    (min: number, max: number) => {
      if (!bounds) return;
      updateFilters({
        minPrice: min > bounds.min ? String(min) : undefined,
        maxPrice: max < bounds.max ? String(max) : undefined,
      });
    },
    [bounds, updateFilters],
  );

  const priceActive = Boolean(
    bounds &&
    ((currentMinPrice && Number(currentMinPrice) > bounds.min) ||
      (currentMaxPrice && Number(currentMaxPrice) < bounds.max)),
  );

  // Location itself is deliberately outside this count and the clear below:
  // it also lives in a cookie and in localStorage, so dropping only its URL
  // params would leave the header's "Deliver to" naming a place the grid no
  // longer honours. The location group keeps its own Clear, which writes
  // through all three. The pickup facet is a plain URL filter and clears.
  const activeCount =
    selectedCategories.length +
    selectedCollections.length +
    selectedStock.length +
    selectedBrands.length +
    (priceActive ? 1 : 0) +
    (pickupNearby ? 1 : 0);

  const clearFilters = useCallback(() => {
    updateFilters({
      category: undefined,
      collection: undefined,
      stock: undefined,
      brand: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      pickup: undefined,
    });
  }, [updateFilters]);

  const visibleCategories = categoriesIndexHref
    ? categories.slice(0, CATEGORIES_VISIBLE_LIMIT)
    : categories;

  return (
    <div>
      {activeCount > 0 ? (
        <div className="flex items-center justify-between gap-2 pb-1">
          <span className="text-xs text-muted-foreground">
            {t("productsPage.filters.activeCount", { count: activeCount })}
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

      <div className="divide-y divide-border/70">
        <LocationFilterSections
          showLocation={showLocation}
          showPickupFacet={showPickupFacet}
          pickupNearby={pickupNearby}
          resultCount={resultCount}
          onPickupChange={(next) =>
            updateFilters({ pickup: next ? PICKUP_NEARBY_PARAM : undefined })
          }
        />

        {categories.length > 0 ? (
          <FacetOptions
            title={t("product.category")}
            options={visibleCategories}
            selected={selectedCategories}
            onToggle={(slug) => toggleValue("category", slug, selectedCategories)}
            viewAllHref={
              categoriesIndexHref && categories.length > CATEGORIES_VISIBLE_LIMIT
                ? categoriesIndexHref
                : undefined
            }
            viewAllLabel={t("common.viewAll")}
          />
        ) : null}

        {collections.length > 0 ? (
          <FacetOptions
            title={t("nav.collections")}
            options={collections.slice(0, COLLECTIONS_VISIBLE_LIMIT)}
            selected={selectedCollections}
            onToggle={(slug) =>
              toggleValue("collection", slug, selectedCollections)
            }
            viewAllHref={
              collections.length > COLLECTIONS_VISIBLE_LIMIT
                ? `/${locale}/collections`
                : undefined
            }
            viewAllLabel={t("common.viewAll")}
          />
        ) : null}

        {/* Availability. Absent when the platform hides sold-out products
            altogether: "In stock" would then narrow nothing and "Out of stock"
            would empty the grid every single time, and a control that empties
            the grid the moment it is touched is worse than an absent one. */}
        {showStockFacet ? (
          <FilterSection title={t("product.availability")}>
            <div className="flex flex-col gap-3.5">
              <FacetCheckbox
                label={t("common.inStock")}
                checked={selectedStock.includes("in")}
                onToggle={() => toggleValue("stock", "in", selectedStock)}
              />
              <FacetCheckbox
                label={t("common.outOfStock")}
                checked={selectedStock.includes("out")}
                onToggle={() => toggleValue("stock", "out", selectedStock)}
              />
            </div>
          </FilterSection>
        ) : null}

        {bounds ? (
          <FilterSection title={t("common.price")}>
            <div className="flex flex-col gap-[17px]">
              <div className="flex items-center gap-2">
                <PriceInput
                  label={t("productsPage.filters.minPrice")}
                  symbol={currency.symbol}
                  min={bounds.min}
                  max={priceValues[1]}
                  value={priceValues[0]}
                  onCommit={(value) => {
                    const next = Math.min(priceValues[1], clampPrice(value));
                    setPriceValues([next, priceValues[1]]);
                    commitPrice(next, priceValues[1]);
                  }}
                />
                <span
                  className="h-px w-3 shrink-0 bg-muted-foreground/60"
                  aria-hidden
                />
                <PriceInput
                  label={t("productsPage.filters.maxPrice")}
                  symbol={currency.symbol}
                  min={priceValues[0]}
                  max={bounds.max}
                  value={priceValues[1]}
                  onCommit={(value) => {
                    const next = Math.max(priceValues[0], clampPrice(value));
                    setPriceValues([priceValues[0], next]);
                    commitPrice(priceValues[0], next);
                  }}
                />
              </div>

              <Slider
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={priceValues}
                onValueChange={(values) =>
                  setPriceValues([values[0], values[1]])
                }
                onValueCommit={(values) => {
                  setPriceValues([values[0], values[1]]);
                  commitPrice(values[0], values[1]);
                }}
                className="[&_[data-slot=slider-range]]:bg-foreground [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-foreground [&_[data-slot=slider-thumb]]:bg-foreground [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:bg-border"
              />

              <p className="text-[13px] text-foreground/80">
                {t("common.price")}:{" "}
                <span className="font-bold text-foreground">
                  {formatPrice(priceValues[0])} - {formatPrice(priceValues[1])}
                </span>
              </p>
            </div>
          </FilterSection>
        ) : null}

        {brands.length > 0 ? (
          <FacetOptions
            title={t("storeProductsPage.brands")}
            options={brands.slice(0, BRANDS_VISIBLE_LIMIT)}
            selected={selectedBrands}
            onToggle={(slug) => toggleValue("brand", slug, selectedBrands)}
            viewAllHref={
              brands.length > BRANDS_VISIBLE_LIMIT ? `/${locale}/brands` : undefined
            }
            viewAllLabel={t("common.viewAll")}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Mobile entry point: the same rail inside a slide-in sheet. `children` lets
 * the page tuck the featured strip under the facets.
 *
 * The trigger is one half of <ProductsMobileToolbar> and `sort` the other, so
 * the phone spends one row on the two controls instead of stacking them —
 * below `lg` the listing shell's own toolbar is hidden, since the rest of it
 * (the density toggles) is desktop-only.
 */
export function ListingFiltersMobile({
  sort,
  children,
  ...props
}: ListingFiltersProps & {
  children?: React.ReactNode;
  /** A `<ProductsSort>` carrying `PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS`. */
  sort?: React.ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const activeCount =
    splitParam(props.currentCategories).length +
    splitParam(props.currentCollections).length +
    splitParam(props.currentStock).length +
    splitParam(props.currentBrands).length +
    (props.currentMinPrice || props.currentMaxPrice ? 1 : 0) +
    countActivePickupFacet(props.currentPickupNearby);

  return (
    <>
      <ProductsMobileToolbar
        filtersLabel={t("common.filters")}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        sort={sort}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[88%] gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b">
            <SheetTitle>{t("common.filters")}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <ListingFilters {...props} />
            {children}
          </div>

          <SheetFooter className="border-t">
            <SheetClose asChild>
              <Button className="w-full">
                {t("productsPage.filters.showResults")}
              </Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The Location group and, once there is a point to measure from, the
 * collection-point facet under it. Rendered inside the rail's `divide-y` so
 * the hairlines fall between whichever groups actually show.
 */
function LocationFilterSections({
  showLocation,
  showPickupFacet,
  pickupNearby,
  resultCount,
  onPickupChange,
}: {
  showLocation: boolean;
  showPickupFacet: boolean;
  pickupNearby: boolean;
  resultCount?: number;
  onPickupChange: (pickupNearby: boolean) => void;
}) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const hasCoordinates = hasLocationCoordinates(
    searchParams.get("lat"),
    searchParams.get("lng"),
  );
  if (!showLocation) return null;

  return (
    <>
      <FilterSection title={t("location.title")}>
        <ProductFiltersLocation
          resultCount={resultCount}
          narrowsResults={pickupNearby}
        />
      </FilterSection>
      {/* Only offered once there is a point to measure from: without one
          "near me" has no answer, and a control that empties the grid the
          moment it is touched is worse than an absent one. */}
      {showPickupFacet && hasCoordinates ? (
        <FilterSection
          title={
            t.has("location.fulfillment")
              ? t("location.fulfillment")
              : "Availability"
          }
        >
          <ProductFiltersPickupFacet
            pickupNearby={pickupNearby}
            onChange={onPickupChange}
          />
        </FilterSection>
      ) : null}
    </>
  );
}

/** A checklist group, with an index link once the list is capped. */
function FacetOptions({
  title,
  options,
  selected,
  onToggle,
  viewAllHref,
  viewAllLabel,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  viewAllHref?: string;
  viewAllLabel: string;
}) {
  return (
    <FilterSection title={title}>
      <div className="flex flex-col gap-3.5">
        {options.map((option) => (
          <FacetCheckbox
            key={option.slug}
            label={option.name}
            checked={selected.includes(option.slug)}
            onToggle={() => onToggle(option.slug)}
          />
        ))}
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {viewAllLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </FilterSection>
  );
}

/**
 * The rail's group frame: semibold title against a minus/plus toggle; the
 * parent's `divide-y` draws the hairline between whichever groups render.
 * Collapse state is view-local on purpose — it is not a filter, so it never
 * touches the URL.
 */
export function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between py-5"
      >
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </span>
        {open ? (
          <Minus className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <Plus className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open ? <div className="pb-6">{children}</div> : null}
    </div>
  );
}

function FacetCheckbox({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="size-3.5 rounded-[3px] border-muted-foreground/40 shadow-none data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
      />
      <span className="text-[13px] text-foreground/85">{label}</span>
    </label>
  );
}

/**
 * The bordered price box: the store currency's symbol and a number that
 * commits on blur or Enter rather than per keystroke — each commit is a
 * navigation, so typing "250" must not load the grid three times.
 */
function PriceInput({
  label,
  symbol,
  min,
  max,
  value,
  onCommit,
}: {
  label: string;
  symbol: string;
  min: number;
  max: number;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Read by the blur/Enter handlers, which run in the same tick as the
  // NumberInput commit that just set the value.
  const latest = useRef(value);

  useApplyOnChange([value], () => {
    latest.current = value;
    setDraft(value);
  });

  const commit = () => onCommit(latest.current);

  return (
    <span className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-lg border border-border px-3">
      <span className="text-sm text-muted-foreground">{symbol}</span>
      <NumberInput
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        whenEmpty="keep"
        normalize={Math.trunc}
        onValueChange={(next) => {
          if (next === undefined) return;
          latest.current = next;
          setDraft(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        className="h-auto w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-center text-sm font-medium text-foreground shadow-none focus-visible:ring-0 dark:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </span>
  );
}
