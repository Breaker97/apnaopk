"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Palette,
  Ruler,
  SlidersHorizontal,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ModernProductCard,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { type Locale } from "@/config/i18n.config";
import { Checkbox } from "@/components/ui/checkbox";
import { useMemo, useState } from "react";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getProductPriceRange,
  productMatchesPriceFilter,
} from "@/lib/products/price-display";
import {
  clampDesktopColumns,
  PRODUCT_GRID_DESKTOP_COLUMN_CLASSES,
  CARD_BROWSER_GRID_GAP,
} from "./product-grid-columns";
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

type ProductCategory =
  | string
  | {
      _id?: string;
      name?: string;
      slug?: string;
    };

type ProductOptionValue = {
  _id: string;
  value: string;
  colorCode?: string;
};

type ProductOption = {
  name: string;
  values?: ProductOptionValue[];
};

type HomeProduct = ModernProduct & {
  category?: ProductCategory;
  options?: ProductOption[];
};

type SortValue = "newest" | "popular" | "rating" | "price_asc" | "price_desc";

interface HomeProductsSectionClientProps {
  products: HomeProduct[];
  locale: Locale;
  title?: string;
  desktopColumns?: number;
}

// Phones swap the chip row for one dropdown; its list is capped as well so the
// menu stays a short pick-list, with an "All Categories" link for the rest.
const MOBILE_CATEGORY_MENU_LIMIT = 6;

const sortOptions: Array<{ label: string; value: SortValue }> = [
  { label: "Newest", value: "newest" },
  { label: "Most Popular", value: "popular" },
  { label: "Best Rating", value: "rating" },
  { label: "Price: Low to High", value: "price_asc" },
  { label: "Price: High to Low", value: "price_desc" },
];

function getCategoryName(product: HomeProduct): string {
  if (!product.category) return "Other";
  if (typeof product.category === "string") return "Other";
  return product.category.name || "Other";
}

function getOptionValuesByName(product: HomeProduct, type: "color" | "size") {
  const options = Array.isArray(product.options) ? product.options : [];
  const keywords =
    type === "color"
      ? ["color", "colour", "colors", "colours"]
      : ["size", "sizes", "sizing"];

  return options
    .filter((option) =>
      keywords.some((keyword) =>
        String(option.name || "")
          .toLowerCase()
          .includes(keyword),
      ),
    )
    .flatMap((option) => option.values || [])
    .map((value) => value.value)
    .filter(Boolean);
}

export function HomeProductsSectionClient({
  products,
  locale,
  title,
  desktopColumns = 4,
}: HomeProductsSectionClientProps) {
  const t = useTranslations();
  const safeDesktopColumns = clampDesktopColumns(desktopColumns);

  const allCategories = useMemo(() => {
    const countMap = new Map<string, number>();

    for (const product of products) {
      const name = getCategoryName(product);
      countMap.set(name, (countMap.get(name) || 0) + 1);
    }

    return Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [products]);

  const allColors = useMemo(() => {
    const colors = new Set<string>();
    for (const product of products) {
      for (const color of getOptionValuesByName(product, "color")) {
        colors.add(color);
      }
    }
    return Array.from(colors).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const allSizes = useMemo(() => {
    const sizes = new Set<string>();
    for (const product of products) {
      for (const size of getOptionValuesByName(product, "size")) {
        sizes.add(size);
      }
    }
    return Array.from(sizes).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const [minPriceBound, maxPriceBound] = useMemo(() => {
    const prices = products.flatMap((product) => {
      const range = getProductPriceRange(product);
      return [range.min, range.max];
    });

    if (!prices.length) return [0, 1000] as const;

    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    return [min, Math.max(min + 1, max)] as const;
  }, [products]);

  const tabItems = useMemo(
    () => ["All Items", ...allCategories.slice(0, 4)],
    [allCategories],
  );

  const [activeTab, setActiveTab] = useState(tabItems[0] || "All Items");
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(
    null,
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortValue>("newest");
  const [priceRange, setPriceRange] = useState<[number, number]>(() => [
    minPriceBound,
    maxPriceBound,
  ]);

  const toggleFilterValue = (
    current: string[],
    nextValue: string,
    setter: (next: string[]) => void,
  ) => {
    if (current.includes(nextValue)) {
      setter(current.filter((value) => value !== nextValue));
      return;
    }
    setter([...current, nextValue]);
  };

  const hasPriceFilter =
    priceRange[0] > minPriceBound || priceRange[1] < maxPriceBound;
  const currentSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || "Newest";
  const hasAnyFilterApplied =
    selectedCategories.length > 0 ||
    selectedColors.length > 0 ||
    selectedSizes.length > 0 ||
    hasPriceFilter;
  // Price counts once regardless of how far the range moved, matching how the
  // individual chips badge themselves.
  const activeFilterCount =
    selectedCategories.length +
    selectedColors.length +
    selectedSizes.length +
    (hasPriceFilter ? 1 : 0);
  const filterLabel = t.has("common.filter") ? t("common.filter") : "Filter";
  const allCategoriesLabel = t.has("common.allCategories")
    ? t("common.allCategories")
    : "All Categories";
  const mobileMenuItems = useMemo(
    () => ["All Items", ...allCategories.slice(0, MOBILE_CATEGORY_MENU_LIMIT)],
    [allCategories],
  );

  const filteredProducts = useMemo(() => {
    const inTab =
      activeTab === "All Items"
        ? products
        : products.filter((product) => getCategoryName(product) === activeTab);

    const withFilters = inTab.filter((product) => {
      const categoryName = getCategoryName(product);
      const colors = getOptionValuesByName(product, "color");
      const sizes = getOptionValuesByName(product, "size");

      const matchesCategory =
        selectedCategories.length === 0 ||
        selectedCategories.includes(categoryName);
      const matchesColor =
        selectedColors.length === 0 ||
        selectedColors.some((selected) => colors.includes(selected));
      const matchesSize =
        selectedSizes.length === 0 ||
        selectedSizes.some((selected) => sizes.includes(selected));
      const matchesPrice =
        productMatchesPriceFilter(product, priceRange[0], priceRange[1]);

      return matchesCategory && matchesColor && matchesSize && matchesPrice;
    });

    const sorted = [...withFilters];

    sorted.sort((a, b) => {
      if (sortBy === "price_asc") {
        return getProductPriceRange(a).min - getProductPriceRange(b).min;
      }
      if (sortBy === "price_desc") {
        return getProductPriceRange(b).max - getProductPriceRange(a).max;
      }
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sortBy === "popular")
        return (b.reviewCount || 0) - (a.reviewCount || 0);

      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return sorted;
  }, [
    activeTab,
    priceRange,
    products,
    selectedCategories,
    selectedColors,
    selectedSizes,
    sortBy,
  ]);

  const clearAllFilters = () => {
    setSelectedCategories([]);
    setSelectedColors([]);
    setSelectedSizes([]);
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

        <div className="mt-4 flex items-center justify-between gap-3 sm:mt-8 sm:flex-wrap sm:gap-4">
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
                  <span className="max-w-36 truncate">{activeTab}</span>
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
                    const isActive = tab === activeTab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab);
                          setIsCategoryMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                          isActive
                            ? "bg-muted font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">{tab}</span>
                        {isActive && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {allCategories.length > MOBILE_CATEGORY_MENU_LIMIT && (
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

            {/* Phones open a bottom sheet; the inline popover row below needs
                more width than a 390px viewport has. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsFilterSheetOpen(true)}
              className="h-8 shrink-0 border-border bg-background px-3.5 text-xs font-semibold text-foreground"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              {filterLabel}
              {activeFilterCount > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold leading-none text-background">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          <div className="hidden min-w-0 items-center sm:flex sm:flex-wrap sm:gap-3">
            {tabItems.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "shrink-0 rounded-button px-5 py-2 text-sm font-semibold transition",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="hidden h-9 bg-foreground px-4 text-xs font-semibold text-background hover:bg-foreground/90 sm:inline-flex sm:h-10 sm:px-5 sm:text-sm"
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
            {filterLabel}
            {isFilterOpen ? (
              <ChevronUp className="ml-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4" />
            ) : (
              <ChevronDown className="ml-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4" />
            )}
          </Button>
        </div>

        {isFilterOpen && (
          <div className="mt-4 hidden sm:block">
            <Separator />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "relative inline-flex h-10 items-center gap-2 rounded-button border px-4 text-sm font-medium",
                        selectedCategories.length > 0
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <Tags className="h-4 w-4" />
                      Categories
                      <ChevronDown className="h-4 w-4" />
                      {selectedCategories.length > 0 && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                          {selectedCategories.length}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 rounded-md p-4">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Categories</p>
                      {allCategories.slice(0, 8).map((category) => {
                        const checked = selectedCategories.includes(category);
                        return (
                          <Label
                            key={category}
                            className="flex items-center gap-3 text-sm font-normal"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                toggleFilterValue(
                                  selectedCategories,
                                  category,
                                  setSelectedCategories,
                                )
                              }
                            />
                            {category}
                          </Label>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "relative inline-flex h-10 items-center gap-2 rounded-button border px-4 text-sm font-medium",
                        selectedColors.length > 0
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <Palette className="h-4 w-4" />
                      Colors
                      <ChevronDown className="h-4 w-4" />
                      {selectedColors.length > 0 && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                          {selectedColors.length}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 rounded-md p-4">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Colors</p>
                      {allColors.slice(0, 10).map((color) => {
                        const checked = selectedColors.includes(color);
                        return (
                          <Label
                            key={color}
                            className="flex items-center gap-3 text-sm font-normal"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                toggleFilterValue(
                                  selectedColors,
                                  color,
                                  setSelectedColors,
                                )
                              }
                            />
                            {color}
                          </Label>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "relative inline-flex h-10 items-center gap-2 rounded-button border px-4 text-sm font-medium",
                        selectedSizes.length > 0
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <Ruler className="h-4 w-4" />
                      Sizes
                      <ChevronDown className="h-4 w-4" />
                      {selectedSizes.length > 0 && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                          {selectedSizes.length}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 rounded-md p-4">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Sizes</p>
                      {allSizes.slice(0, 10).map((size) => {
                        const checked = selectedSizes.includes(size);
                        return (
                          <Label
                            key={size}
                            className="flex items-center gap-3 text-sm font-normal"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                toggleFilterValue(
                                  selectedSizes,
                                  size,
                                  setSelectedSizes,
                                )
                              }
                            />
                            {size}
                          </Label>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

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

        {/* Mobile filter sheet. Same state as the desktop popovers, laid out as
            one scrollable list with a sticky action bar so Apply and Clear stay
            reachable however long the options run. */}
        <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] gap-0 rounded-t-2xl p-0 sm:hidden"
          >
            {/* Grab handle — the visual cue that this panel is dismissible by
                dragging, which a plain bordered header does not convey. */}
            <div
              aria-hidden="true"
              className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
            />
            <SheetHeader className="border-b px-4 py-3 pr-12">
              <SheetTitle className="text-base">{filterLabel}</SheetTitle>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
              <FilterCheckGroup
                title="Categories"
                options={allCategories.slice(0, 8)}
                selected={selectedCategories}
                onToggle={(value) =>
                  toggleFilterValue(
                    selectedCategories,
                    value,
                    setSelectedCategories,
                  )
                }
              />

              <FilterCheckGroup
                title="Colors"
                options={allColors.slice(0, 10)}
                selected={selectedColors}
                onToggle={(value) =>
                  toggleFilterValue(selectedColors, value, setSelectedColors)
                }
              />

              <FilterCheckGroup
                title="Sizes"
                options={allSizes.slice(0, 10)}
                selected={selectedSizes}
                onToggle={(value) =>
                  toggleFilterValue(selectedSizes, value, setSelectedSizes)
                }
              />

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
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
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
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Sort</p>
                <div className="space-y-1">
                  {sortOptions.map((option) => {
                    const isSelected = option.value === sortBy;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSortBy(option.value)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm",
                          isSelected
                            ? "bg-muted font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {option.label}
                        {isSelected && <Check className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                onClick={clearAllFilters}
                disabled={!hasAnyFilterApplied}
              >
                Clear
              </Button>
              <Button
                type="button"
                className="h-11 flex-1"
                onClick={() => setIsFilterSheetOpen(false)}
              >
                {`Show ${filteredProducts.length}`}
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            "mt-5 grid grid-cols-2 sm:mt-8 md:mt-8 md:grid-cols-3",
            CARD_BROWSER_GRID_GAP,
            PRODUCT_GRID_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {filteredProducts.map((product) => (
            <ModernProductCard
              key={product._id}
              product={product}
              locale={locale}
              showQuickView
              onQuickView={setQuickViewProduct}
            />
          ))}
        </div>

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

// One checkbox group in the mobile filter sheet. Rendered as full-width rows so
// each option gets a comfortable tap target, unlike the dense popover lists.
function FilterCheckGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      <div className="space-y-0.5">
        {options.map((option) => (
          <Label
            key={option}
            className="flex min-h-11 items-center gap-3 rounded-md text-sm font-normal"
          >
            <Checkbox
              checked={selected.includes(option)}
              onCheckedChange={() => onToggle(option)}
            />
            {option}
          </Label>
        ))}
      </div>
    </div>
  );
}
