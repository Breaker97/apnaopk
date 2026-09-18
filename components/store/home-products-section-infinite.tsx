"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ModernProductCard,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { type Locale } from "@/config/i18n.config";
import { Separator } from "@/components/ui/separator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getProductPriceRange } from "@/lib/products/price-display";
import {
  clampDesktopColumns,
  PRODUCT_GRID_DESKTOP_COLUMN_CLASSES,
  CARD_BROWSER_GRID_GAP,
} from "./product-grid-columns";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { NumberInput } from "@/components/ui/number-input";

// Loaded only when a shopper opens quick view, keeping the modal and its deps
// out of the initial section bundle.
const ProductQuickViewModal = dynamic(
  () =>
    import("@/components/products/product-quick-view-modal").then(
      (mod) => mod.ProductQuickViewModal,
    ),
  { ssr: false },
);

type FeaturedCategory = {
  name: string;
  slug: string;
};

type SortValue = "newest" | "popular" | "rating" | "price_asc" | "price_desc";

interface HomeProductsSectionInfiniteProps {
  locale: Locale;
  title?: string;
  categories: FeaturedCategory[];
  initialProducts: ModernProduct[];
  initialHasNext: boolean;
  pageSize: number;
  desktopColumns?: number;
}

const sortOptions: Array<{ label: string; value: SortValue }> = [
  { label: "Newest", value: "newest" },
  { label: "Most Popular", value: "popular" },
  { label: "Best Rating", value: "rating" },
  { label: "Price: Low to High", value: "price_asc" },
  { label: "Price: High to Low", value: "price_desc" },
];

// Keep the tab row to a single line of the most relevant categories instead of
// listing every category (stores can have hundreds), which wraps into a wall of
// chips. Categories arrive pre-sorted by admin `order` then name, so the first
// few are the curated/top ones.
const MAX_CATEGORY_TABS = 7;

// Phones swap the chip row for one dropdown; its list is capped as well so the
// menu stays a short pick-list, with an "All Categories" link for the rest.
const MOBILE_CATEGORY_MENU_LIMIT = 6;

const SORT_PARAMS: Record<SortValue, { sortBy: string; sortOrder?: string }> = {
  newest: { sortBy: "createdAt", sortOrder: "desc" },
  popular: { sortBy: "popular" },
  rating: { sortBy: "rating" },
  price_asc: { sortBy: "price", sortOrder: "asc" },
  price_desc: { sortBy: "price", sortOrder: "desc" },
};

type ApiResponse = {
  data?: {
    data?: ModernProduct[];
    pagination?: { page?: number; hasNext?: boolean };
  };
};

export function HomeProductsSectionInfinite({
  locale,
  title,
  categories,
  initialProducts,
  initialHasNext,
  pageSize,
  desktopColumns = 4,
}: HomeProductsSectionInfiniteProps) {
  const t = useTranslations();
  const safeDesktopColumns = clampDesktopColumns(desktopColumns);

  // Price bounds are derived once from the first page so the slider stays
  // stable while the shopper interacts with it.
  const [minPriceBound, maxPriceBound] = useMemo(() => {
    const prices = initialProducts.flatMap((product) => {
      const range = getProductPriceRange(product);
      return [range.min, range.max];
    });

    if (!prices.length) return [0, 1000] as const;

    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    return [min, Math.max(min + 1, max)] as const;
  }, [initialProducts]);

  const tabItems = useMemo(
    () => [
      { name: "All Items", slug: "" },
      ...categories.slice(0, MAX_CATEGORY_TABS),
    ],
    [categories],
  );

  const [products, setProducts] = useState<ModernProduct[]>(initialProducts);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(initialHasNext);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);

  const [activeCategorySlug, setActiveCategorySlug] = useState("");
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortValue>("newest");
  const [priceRange, setPriceRange] = useState<[number, number]>(() => [
    minPriceBound,
    maxPriceBound,
  ]);
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(
    null,
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Skip the refetch effect on first render — the server already provided
  // page 1 for the default filters.
  const isInitialMount = useRef(true);
  // Bumped whenever filters change so an in-flight loadMore can discard its
  // result if it resolves after a filter change replaced the list.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
  }, [activeCategorySlug, sortBy, priceRange]);

  const hasPriceFilter =
    priceRange[0] > minPriceBound || priceRange[1] < maxPriceBound;

  // Server refreshes (StorefrontRefresh after a back/forward nav or tab
  // refocus) hand down a new initialProducts. When no client-side filters are
  // active, the top of the list mirrors the server's first page — so when that
  // page actually changes (product added/renamed/repriced/out of stock),
  // restart from it; infinite scroll re-fills the tail as the shopper scrolls.
  // The content comparison keeps no-op refreshes (identical data, new array
  // identity) from collapsing an already-scrolled list. With filters active
  // the list is client-owned and every change already refetches fresh data
  // from /api/products, which is served no-store.
  const hasClientFilter =
    activeCategorySlug !== "" || sortBy !== "newest" || hasPriceFilter;
  useApplyOnChange([
    initialProducts, initialHasNext, hasClientFilter, products
  ], () => {
    if (hasClientFilter) return;

    const firstPageUnchanged =
      products.length >= initialProducts.length &&
      initialProducts.every((next, index) => {
        const current = products[index];
        return (
          current._id === next._id &&
          current.name === next.name &&
          current.price === next.price &&
          current.comparePrice === next.comparePrice &&
          current.stock === next.stock &&
          current.images?.[0] === next.images?.[0]
        );
      });
    if (firstPageUnchanged) return;

    setProducts(initialProducts);
    setPage(1);
    setHasNext(initialHasNext);
  });
  const currentSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || "Newest";
  const hasAnyFilterApplied = activeCategorySlug !== "" || hasPriceFilter;
  const filterLabel = t.has("common.filter") ? t("common.filter") : "Filter";
  const allCategoriesLabel = t.has("common.allCategories")
    ? t("common.allCategories")
    : "All Categories";
  const activeTabName =
    tabItems.find((tab) => tab.slug === activeCategorySlug)?.name ??
    "All Items";
  const mobileMenuItems = useMemo(
    () => [
      { name: "All Items", slug: "" },
      ...categories.slice(0, MOBILE_CATEGORY_MENU_LIMIT),
    ],
    [categories],
  );

  const buildQuery = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(pageSize));
      // This grid renders ModernProductCard (same as the server-rendered first
      // page, which uses cardFieldsOnly) — request only card fields so the
      // continuation pages don't pull full variant/media-heavy docs.
      params.set("cardFieldsOnly", "true");

      const sort = SORT_PARAMS[sortBy];
      params.set("sortBy", sort.sortBy);
      if (sort.sortOrder) params.set("sortOrder", sort.sortOrder);

      if (activeCategorySlug) params.set("category", activeCategorySlug);
      if (priceRange[0] > minPriceBound)
        params.set("minPrice", String(priceRange[0]));
      if (priceRange[1] < maxPriceBound)
        params.set("maxPrice", String(priceRange[1]));

      return params.toString();
    },
    [
      activeCategorySlug,
      maxPriceBound,
      minPriceBound,
      pageSize,
      priceRange,
      sortBy,
    ],
  );

  const loadMore = useCallback(async () => {
    if (isLoadingMore || isRefetching || !hasNext) return;

    setIsLoadingMore(true);
    setHasLoadError(false);

    const gen = generation.current;
    try {
      const nextPage = page + 1;
      const response = await fetch(`/api/products?${buildQuery(nextPage)}`);
      const result = (await response.json()) as ApiResponse;
      // A filter changed while this page was loading — discard it; the refetch
      // effect owns the list now.
      if (gen !== generation.current) return;
      const nextProducts = result?.data?.data ?? [];
      const pagination = result?.data?.pagination;

      setProducts((current) => {
        const seen = new Set(current.map((product) => product._id));
        const additions = nextProducts.filter(
          (product) => !seen.has(product._id),
        );
        return [...current, ...additions];
      });
      setPage(pagination?.page ?? nextPage);
      setHasNext(Boolean(pagination?.hasNext));
    } catch {
      setHasLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [buildQuery, hasNext, isLoadingMore, isRefetching, page]);

  // Refetch page 1 whenever a filter changes (debounced for the price slider).
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsRefetching(true);
      setHasLoadError(false);

      try {
        const response = await fetch(`/api/products?${buildQuery(1)}`);
        const result = (await response.json()) as ApiResponse;
        if (cancelled) return;

        const nextProducts = result?.data?.data ?? [];
        const pagination = result?.data?.pagination;
        setProducts(nextProducts);
        setPage(pagination?.page ?? 1);
        setHasNext(Boolean(pagination?.hasNext));
      } catch {
        if (!cancelled) setHasLoadError(true);
      } finally {
        if (!cancelled) setIsRefetching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildQuery]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNext) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "420px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNext, loadMore]);

  const clearAllFilters = () => {
    setActiveCategorySlug("");
    setPriceRange([minPriceBound, maxPriceBound]);
    setSortBy("newest");
  };

  return (
    <section className="py-6 lg:py-12">
      <div className="container mx-auto px-4">
        <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight text-foreground sm:text-[length:var(--sec-title-lg,1.5rem)]">
          {title ||
            (t.has("home.findFavoriteProducts")
              ? t("home.findFavoriteProducts")
              : "Find your favorite products.")}
        </h2>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 sm:mt-8 sm:gap-4">
          {/* Phones: a wall of category chips wrapped into several lines, so
              the row collapses to one compact dropdown (capped list + an
              "All Categories" link) with the filter pill sitting beside it. */}
          <div className="flex items-center gap-2 sm:hidden">
            <Popover
              open={isCategoryMenuOpen}
              onOpenChange={setIsCategoryMenuOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-button border border-border bg-background px-3.5 text-xs font-semibold text-foreground"
                >
                  <span className="max-w-36 truncate">{activeTabName}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      isCategoryMenuOpen && "rotate-180",
                    )}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 rounded-xl p-1.5">
                <div className="space-y-0.5">
                  {mobileMenuItems.map((tab) => {
                    const isActive = tab.slug === activeCategorySlug;
                    return (
                      <button
                        key={tab.slug || "all"}
                        type="button"
                        onClick={() => {
                          setActiveCategorySlug(tab.slug);
                          setIsCategoryMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                          isActive
                            ? "bg-muted font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">{tab.name}</span>
                        {isActive && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {categories.length > MOBILE_CATEGORY_MENU_LIMIT && (
                  <>
                    <Separator className="my-1.5" />
                    <Link
                      href={`/${locale}/categories`}
                      onClick={() => setIsCategoryMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm font-semibold text-primary"
                    >
                      {allCategoriesLabel}
                    </Link>
                  </>
                )}
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              variant="outline"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              className="h-8 shrink-0 border-border bg-background px-3.5 text-xs font-semibold text-foreground"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              {filterLabel}
              {isFilterOpen ? (
                <ChevronUp className="ml-1.5 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex sm:gap-3">
            {tabItems.map((tab) => {
              const isActive = tab.slug === activeCategorySlug;
              return (
                <button
                  key={tab.slug || "all"}
                  type="button"
                  onClick={() => setActiveCategorySlug(tab.slug)}
                  className={cn(
                    "rounded-button px-5 py-2 text-sm font-semibold transition",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  {tab.name}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="hidden h-10 bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90 sm:inline-flex"
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            {filterLabel}
            {isFilterOpen ? (
              <ChevronUp className="ml-1.5 h-4 w-4" />
            ) : (
              <ChevronDown className="ml-1.5 h-4 w-4" />
            )}
          </Button>
        </div>

        {isFilterOpen && (
          <div className="mt-4">
            <Separator />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "relative inline-flex h-10 items-center gap-2 rounded-button border px-4 text-sm font-medium",
                        hasPriceFilter
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <DollarSign className="h-4 w-4" />
                      Price
                      <ChevronDown className="h-4 w-4" />
                      {hasPriceFilter && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                          1
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 rounded-md p-4">
                    <div className="space-y-4">
                      <p className="text-sm font-semibold">Price</p>
                      <Slider
                        min={minPriceBound}
                        max={maxPriceBound}
                        step={1}
                        value={priceRange}
                        onValueChange={(value) => {
                          if (value.length === 2) {
                            setPriceRange([value[0], value[1]]);
                          }
                        }}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs text-muted-foreground">
                          Min
                          <NumberInput
                            min={minPriceBound}
                            max={priceRange[1]}
                            step={1}
                            value={priceRange[0]}
                            whenEmpty="keep"
                            normalize={Math.trunc}
                            onValueChange={(next) => {
                              if (next === undefined) return;
                              setPriceRange([next, priceRange[1]]);
                            }}
                            className="h-8 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-muted-foreground">
                          Max
                          <NumberInput
                            min={priceRange[0]}
                            max={maxPriceBound}
                            step={1}
                            value={priceRange[1]}
                            whenEmpty="keep"
                            normalize={Math.trunc}
                            onValueChange={(next) => {
                              if (next === undefined) return;
                              setPriceRange([priceRange[0], next]);
                            }}
                            className="h-8 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                          />
                        </label>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center gap-2">
                {hasAnyFilterApplied && (
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={clearAllFilters}
                  >
                    Clear
                  </button>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-10 items-center gap-2 rounded-button border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {currentSortLabel}
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 rounded-md p-2">
                    <div className="space-y-1">
                      {sortOptions.map((option) => {
                        const isSelected = option.value === sortBy;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setSortBy(option.value)}
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
                              isSelected
                                ? "bg-muted font-semibold text-foreground"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            {option.label}
                            {isSelected && <Check className="h-4 w-4" />}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "mt-5 grid grid-cols-2 transition-opacity sm:mt-8 md:mt-8 md:grid-cols-3",
            CARD_BROWSER_GRID_GAP,
            PRODUCT_GRID_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
            isRefetching && "pointer-events-none opacity-50",
          )}
        >
          {products.map((product) => (
            <ModernProductCard
              key={product._id}
              product={product}
              locale={locale}
              showQuickView
              onQuickView={setQuickViewProduct}
            />
          ))}
        </div>

        {!isRefetching && products.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t.has("products.noProducts")
              ? t("products.noProducts")
              : "No products found."}
          </p>
        )}

        {hasNext && (
          <div
            ref={sentinelRef}
            className="mt-10 flex items-center justify-center"
          >
            {(isLoadingMore || isRefetching) && (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        )}

        {hasLoadError && (
          <div className="mt-6 flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadMore()}
            >
              {t.has("common.retry") ? t("common.retry") : "Try again"}
            </Button>
          </div>
        )}

        {quickViewProduct && (
          <ProductQuickViewModal
            product={quickViewProduct}
            locale={locale}
            open
            onClose={() => setQuickViewProduct(null)}
          />
        )}
      </div>
    </section>
  );
}
