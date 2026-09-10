"use client";

import Link from "next/link";
import { Star, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { useCurrency } from "@/providers/currency-provider";
import {
  formatProductCompareAtPrice,
  formatProductPrice,
} from "@/lib/products/price-display";
import {
  buildCompareHref,
  buildCompareRows,
  type CompareProduct,
} from "@/lib/products/compare";
import { cn } from "@/lib/utils";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * The comparison grid: a sticky label column and one column per product.
 *
 * Client-side because prices format through `useCurrency` exactly as they do
 * everywhere else on the storefront — the server hands over raw numbers, so
 * switching currency reprices the table without another round trip.
 *
 * The whole thing is a CSS grid rather than a `<table>` so a column can be
 * removed, shaded and made scrollable without fighting table layout; the
 * roles are declared explicitly so it still reads as a table to assistive
 * technology.
 */
export function CompareTable({
  locale,
  products,
  selection,
}: {
  locale: Locale;
  products: CompareProduct[];
  /** The slugs in URL order — every remove link is built from this. */
  selection: string[];
}) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const rows = buildCompareRows(products);

  const tf = useFallbackTranslator(t);

  // One shared template so the header cells and every value row stay in
  // lockstep — a second definition is how comparison tables drift.
  const gridTemplate = {
    gridTemplateColumns: `minmax(120px, 180px) repeat(${products.length}, minmax(0, 1fr))`,
  };
  // The grid needs a floor, not `min-w-max`: max-content lets one long spec
  // value ("Nano-SIM + eSIM + eSIM (max 2 at a time; International) | …")
  // stretch its column past 700px and push the other products off-screen,
  // which is the one thing a comparison table must never do. Below this
  // width the wrapper scrolls; above it the columns share the room evenly
  // and long values wrap inside their own cell.
  const minWidth = `${180 + products.length * 190}px`;

  return (
    <div className="overflow-hidden rounded-4xl border border-border">
      {/* The grid is wider than a phone; scrolling it beats stacking, which
          would destroy the side-by-side reading the page exists for. */}
      <div className="overflow-x-auto">
        <div role="table" className="w-full" style={{ minWidth }}>
          <div role="rowgroup">
            <div role="row" className="grid" style={gridTemplate}>
              <span
                role="rowheader"
                className="flex items-center px-5 py-6 text-sm font-bold text-foreground"
              >
                {tf("compare.products", "Products")}
              </span>
              {products.map((product, index) => (
                <span
                  key={product.id}
                  role="columnheader"
                  className={cn(
                    "relative flex flex-col gap-3 border-s border-border px-5 py-6",
                    // The design shades every other column so the eye can
                    // hold its place across a wide row.
                    index % 2 === 1 && "bg-muted/40",
                  )}
                >
                  <Link
                    href={buildCompareHref(locale, selection, {
                      remove: product.slug,
                    })}
                    aria-label={tf("compare.remove", "Remove from comparison")}
                    // z-10: the product link below is positioned too, so without it the
                    // image paints over this corner and the remove target is dead.
                    className="absolute end-3 top-3 z-10 grid size-6 place-items-center rounded-full bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    scroll={false}
                  >
                    <X className="size-4" />
                  </Link>

                  <Link
                    href={`/${locale}/products/${product.slug}`}
                    className="group flex flex-col gap-3"
                  >
                    <span className="relative block h-[180px] w-full overflow-hidden rounded-xl bg-muted/50">
                      {product.image ? (
                        <AppImage
                          src={product.image}
                          alt=""
                          fill
                          sizes="240px"
                          className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : null}
                    </span>
                    <span className="text-lg font-semibold tracking-tight text-foreground">
                      {product.name}
                    </span>
                  </Link>

                  <span className="flex flex-wrap items-center gap-2">
                    {product.priceOnRequest ? (
                      <span className="text-base text-foreground">
                        {t("product.priceOnRequest")}
                      </span>
                    ) : (
                      <>
                        <span className="text-base text-foreground">
                          {formatProductPrice(product, formatPrice)}
                        </span>
                        {formatProductCompareAtPrice(product, formatPrice) ? (
                          <span className="text-sm text-muted-foreground line-through">
                            {formatProductCompareAtPrice(product, formatPrice)}
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>

                  <span className="flex items-center gap-1.5">
                    <span className="flex items-center">
                      {Array.from({ length: 5 }).map((_, star) => (
                        <Star
                          key={star}
                          className={cn(
                            "size-3.5",
                            star < Math.round(product.rating)
                              ? "fill-amber-500 text-amber-500"
                              : "fill-muted-foreground text-muted-foreground opacity-30",
                          )}
                        />
                      ))}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {product.rating.toFixed(1)}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div role="rowgroup">
            {rows.map((row) => (
              <div
                key={row.label}
                role="row"
                className="grid border-t border-border"
                style={gridTemplate}
              >
                <span
                  role="rowheader"
                  className="px-5 py-4 text-sm font-bold text-foreground"
                >
                  {row.label}
                </span>
                {row.values.map((value, index) => (
                  <span
                    key={`${row.label}-${products[index]?.id ?? index}`}
                    role="cell"
                    className={cn(
                      // `whitespace-pre-line` keeps a merchant's line breaks
                      // — spec values are routinely written as short lists.
                      "whitespace-pre-line border-s border-border px-5 py-4 text-sm text-foreground",
                      index % 2 === 1 && "bg-muted/40",
                    )}
                  >
                    {value || (
                      // Never blank: an empty cell reads as a rendering
                      // failure, where a dash reads as "this one doesn't
                      // say" — which is itself a comparison result.
                      <span
                        className="text-muted-foreground"
                        title={tf("compare.notSpecified", "Not specified")}
                      >
                        —
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
          {tf(
            "compare.noAttributes",
            "These products have no specifications to compare yet.",
          )}
        </p>
      ) : null}
    </div>
  );
}
