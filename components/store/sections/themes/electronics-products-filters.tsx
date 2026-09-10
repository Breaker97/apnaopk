"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ProductsMobileToolbar } from "@/components/products/products-mobile-toolbar";
import { type Locale } from "@/config/i18n.config";
import { PICKUP_NEARBY_PARAM } from "@/lib/locations/shopper-location";
import type { StorefrontProductPriceRange } from "@/lib/products/storefront-product-filters";
import {
  FacetCheckbox,
  FilterSection,
  LocationFilterSections,
  PriceInput,
  countActivePickupFacet,
  type ElectronicsFilterOption,
  type ElectronicsLocationFilterProps,
} from "./electronics-category-filters";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface ElectronicsProductsFiltersProps extends ElectronicsLocationFilterProps {
  locale: Locale;
  /** The whole store's categories — this listing has no branch to scope to. */
  categories: ElectronicsFilterOption[];
  brands: ElectronicsFilterOption[];
  priceRange: StorefrontProductPriceRange | null;
  currentCategories?: string;
  currentStock?: string;
  currentBrands?: string;
  currentMinPrice?: string;
  currentMaxPrice?: string;
  /** False once the platform hides sold-out products — see the facet below. */
  showStockFacet?: boolean;
}

/**
 * Options listed before a taxonomy group defers to its own index page — the
 * same caps the classic sidebar and the category sidebar apply, so no group
 * can push the featured strip off the screen.
 */
const CATEGORIES_VISIBLE_LIMIT = 10;
const BRANDS_VISIBLE_LIMIT = 8;

/**
 * The Electronics products sidebar: category, availability, price and brand
 * facets in the design's flat checklist style — the products-page sibling of
 * `ElectronicsCategoryFilters`, composed from the same primitives so the two
 * listings cannot drift apart. Its own component rather than a mode of the
 * category panel because the facet set differs: the whole category tree with
 * an index link instead of one branch's children.
 *
 * State lives entirely in the URL (`category`, `stock`, `brand`,
 * `minPrice`/`maxPrice`) — the same params the grid and its page links carry.
 */
export function ElectronicsProductsFilters({
  locale,
  categories,
  brands,
  priceRange,
  currentCategories,
  currentStock,
  currentBrands,
  currentMinPrice,
  currentMaxPrice,
  showStockFacet = true,
  showLocation = false,
  showPickupFacet = false,
  currentPickupNearby,
  resultCount,
}: ElectronicsProductsFiltersProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Any value means on; only absence means "All sellers".
  const pickupNearby = Boolean(currentPickupNearby);

  const selectedCategories = useMemo(
    () => (currentCategories ? currentCategories.split(",") : []),
    [currentCategories],
  );
  const selectedStock = useMemo(
    () => (currentStock ? currentStock.split(",") : []),
    [currentStock],
  );
  const selectedBrands = useMemo(
    () => (currentBrands ? currentBrands.split(",") : []),
    [currentBrands],
  );

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
  // through all three. The collection facet is a plain URL filter and clears.
  const activeCount =
    selectedCategories.length +
    selectedStock.length +
    selectedBrands.length +
    (priceActive ? 1 : 0) +
    (pickupNearby ? 1 : 0);

  const clearFilters = useCallback(() => {
    updateFilters({
      category: undefined,
      stock: undefined,
      brand: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      pickup: undefined,
    });
  }, [updateFilters]);

  const visibleCategories = categories.slice(0, CATEGORIES_VISIBLE_LIMIT);
  const visibleBrands = brands.slice(0, BRANDS_VISIBLE_LIMIT);

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
          <FilterSection title={t("product.category")}>
            <div className="flex flex-col gap-3.5">
              {visibleCategories.map((category) => (
                <FacetCheckbox
                  key={category.slug}
                  label={category.name}
                  checked={selectedCategories.includes(category.slug)}
                  onToggle={() =>
                    toggleValue("category", category.slug, selectedCategories)
                  }
                />
              ))}
              {categories.length > CATEGORIES_VISIBLE_LIMIT ? (
                <Link
                  href={`/${locale}/categories`}
                  className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t("common.viewAll")}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </FilterSection>
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
                  ${priceValues[0].toLocaleString()} - $
                  {priceValues[1].toLocaleString()}
                </span>
              </p>
            </div>
          </FilterSection>
        ) : null}

        {brands.length > 0 ? (
          <FilterSection title={t("storeProductsPage.brands")}>
            <div className="flex flex-col gap-3.5">
              {visibleBrands.map((brand) => (
                <FacetCheckbox
                  key={brand.slug}
                  label={brand.name}
                  checked={selectedBrands.includes(brand.slug)}
                  onToggle={() =>
                    toggleValue("brand", brand.slug, selectedBrands)
                  }
                />
              ))}
              {brands.length > BRANDS_VISIBLE_LIMIT ? (
                <Link
                  href={`/${locale}/brands`}
                  className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t("common.viewAll")}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </FilterSection>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Mobile entry point: the same panel inside a slide-in sheet, mirroring
 * `ElectronicsCategoryFiltersMobile` so the two listings feel the same on a
 * phone. `children` lets the page tuck the featured strip under the facets.
 *
 * The trigger is one half of <ProductsMobileToolbar> and `sort` the other, so
 * the phone spends one row on the two controls instead of stacking them —
 * below `lg` the listing shell's own toolbar is hidden, since the rest of it
 * (the density toggles) is desktop-only.
 */
export function ElectronicsProductsFiltersMobile({
  sort,
  ...props
}: ElectronicsProductsFiltersProps & {
  children?: React.ReactNode;
  /** A `<ProductsSort>` carrying `PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS`. */
  sort?: React.ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const activeCount =
    (props.currentCategories ? props.currentCategories.split(",").length : 0) +
    (props.currentStock ? props.currentStock.split(",").length : 0) +
    (props.currentBrands ? props.currentBrands.split(",").length : 0) +
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
            <ElectronicsProductsFilters {...props} />
            {props.children}
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
