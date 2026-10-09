"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  ProductFilters,
  resolvePriceBounds,
  type ProductFiltersProps,
} from "@/components/products/product-filters";
import { ProductsMobileToolbar } from "@/components/products/products-mobile-toolbar";

function countActiveFilters({
  currentCategory,
  currentCollection,
  currentMinPrice,
  currentMaxPrice,
  priceRange,
  currentPickupNearby,
}: ProductFiltersProps): number {
  let count = 0;
  if (currentCategory) count += currentCategory.split(",").length;
  if (currentCollection) count += currentCollection.split(",").length;
  // Counted here or the facet is invisible on mobile: the sheet is closed, so
  // the badge is the only thing telling a shopper why the grid is narrow.
  if (currentPickupNearby) count += 1;

  // Compare against the same bounds the slider uses — against a hardcoded
  // $0–1000 a $2,400 store showed "1 filter active" with nothing filtered.
  const bounds = resolvePriceBounds(priceRange);
  const min = currentMinPrice ? parseInt(currentMinPrice) : bounds.min;
  const max = currentMaxPrice ? parseInt(currentMaxPrice) : bounds.max;
  if (min > bounds.min || max < bounds.max) count += 1;

  return count;
}

/**
 * Mobile-only filter entry point. Opens a slide-in Sheet wrapping the shared
 * <ProductFilters> panel, so products stay at the top of the page on small
 * screens. Hidden on lg+ where the desktop sidebar is shown instead.
 *
 * The trigger is one half of <ProductsMobileToolbar>; a page that hands over
 * its `sort` gets both controls on that one row instead of two stacked ones.
 * The sheet root needs no trigger of its own — it is controlled, so the
 * toolbar's button drives it from outside.
 */
export function ProductFiltersMobile({
  sort,
  ...props
}: ProductFiltersProps & {
  /** A `<ProductsSort>` carrying `PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS`. */
  sort?: ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(props);

  return (
    <>
      <ProductsMobileToolbar
        filtersLabel={t("common.filters")}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        sort={sort}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[88%] gap-0 p-0 sm:max-w-sm"
        >
          <SheetHeader className="border-b">
            <SheetTitle>
              {t("common.filters")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <ProductFilters {...props} />
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
