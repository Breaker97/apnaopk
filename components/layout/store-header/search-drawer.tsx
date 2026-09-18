"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { AppImage } from "@/components/ui/app-image";
import { formatProductPrice } from "@/lib/products/price-display";
import type { ModernProduct } from "@/lib/products/modern-product";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";

export interface SearchDrawerShelf {
  id: string;
  title: string;
  slug: string;
  products: ModernProduct[];
}

interface SearchDrawerSuggestion {
  _id: string;
  slug: string;
  name?: string;
  title?: string;
  images?: string[];
}

/**
 * Shelves are fetched once per set of collections for the life of the page:
 * the drawer is opened, closed and opened again, and the rows it shows do
 * not change between those.
 */
const shelfCache = new Map<string, Promise<SearchDrawerShelf[]>>();

function loadShelves(collectionIds: string[]): Promise<SearchDrawerShelf[]> {
  const key = collectionIds.join(",");
  const cached = shelfCache.get(key);
  if (cached) return cached;
  const request = fetch(
    `/api/search-drawer?collections=${encodeURIComponent(key)}`,
  )
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) =>
      Array.isArray(payload?.data?.shelves)
        ? (payload.data.shelves as SearchDrawerShelf[])
        : [],
    )
    .catch(() => {
      // A failed request must not poison the cache for the rest of the visit.
      shelfCache.delete(key);
      return [];
    });
  shelfCache.set(key, request);
  return request;
}

/**
 * The search drawer behind a header search icon — Louis Vuitton's: the
 * panel drops from the top, a wide field takes focus, a row of trending
 * terms sits under it, and the merchant's chosen collections run beneath as
 * product rows. Typing swaps the rows for live results.
 *
 * The query, its debounced suggestions and the submit are the HEADER'S own
 * search state, passed in — so the drawer answers exactly as the header's
 * other search fields do, spelling correction and zero-result reporting
 * included, instead of growing a second search implementation.
 */
export function SearchDrawer({
  open,
  onOpenChange,
  locale,
  query,
  onQueryChange,
  onSubmit,
  suggestions,
  isSearching,
  correctedTo,
  placeholder,
  trending,
  collectionIds,
  fieldStyle = "outline",
  fieldRadius = 999,
  brand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  suggestions: SearchDrawerSuggestion[];
  isSearching: boolean;
  correctedTo: string | null;
  placeholder: string;
  trending: string[];
  collectionIds: string[];
  /** A bordered box, or a line beneath the text — set on the search icon. */
  fieldStyle?: "outline" | "underline";
  /** The bordered field's corners, px; 999 is a pill. */
  fieldRadius?: number;
  /** The store's logo over the field, or its name when it has none. */
  brand: { logoUrl: string; name: string };
}) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [shelves, setShelves] = useState<SearchDrawerShelf[] | null>(null);
  const shelfKey = collectionIds.join(",");

  useEffect(() => {
    if (!open || !shelfKey) return;
    let cancelled = false;
    void loadShelves(shelfKey.split(",")).then((rows) => {
      if (!cancelled) setShelves(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, shelfKey]);

  const typing = query.trim().length >= 2;
  const trendingLabel = t.has("nav.trendingSearches")
    ? t("nav.trendingSearches")
    : "Trending searches";
  const closeLabel = t.has("common.close") ? t("common.close") : "Close";

  const submit = (event: FormEvent) => {
    onSubmit(event);
    if (query.trim()) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="top"
        showCloseButton={false}
        className="max-h-[92svh] gap-0 overflow-y-auto border-0 p-0"
        onOpenAutoFocus={(event) => {
          // Focus the field rather than the first focusable element (the
          // close button), so a shopper can type the moment it opens.
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">
          {t.has("common.search") ? t("common.search") : "Search"}
        </SheetTitle>

        <div className="relative px-4 pb-6 pt-5 sm:px-8">
          <div className="flex min-h-10 items-center justify-center">
            {brand.logoUrl ? (
              <span className="block h-8 w-40">
                <AppImage
                  src={brand.logoUrl}
                  alt={brand.name}
                  width={160}
                  height={32}
                  className="h-8 w-full object-contain"
                />
              </span>
            ) : (
              <span className="text-2xl font-medium tracking-[0.12em] uppercase">
                {brand.name}
              </span>
            )}
          </div>
          <SheetClose
            aria-label={closeLabel}
            className="absolute end-4 top-5 grid h-10 w-10 place-items-center rounded-full transition-opacity hover:opacity-70 sm:end-8"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </SheetClose>

          <form
            onSubmit={submit}
            role="search"
            className="mx-auto mt-5 w-full max-w-5xl"
          >
            <label className="relative block">
              <Search
                className={cn(
                  "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 opacity-60",
                  // On a bare line the glyph sits at the line's start, not
                  // inset into a box that is not there.
                  fieldStyle === "underline" ? "start-0" : "start-6",
                )}
                aria-hidden
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className={cn(
                  "h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground",
                  fieldStyle === "underline"
                    ? // Only the line: it thickens on focus instead of a ring.
                      "rounded-none border-0 border-b border-foreground/80 pe-10 ps-8 transition-[border-width] focus:border-b-2"
                    : "border border-foreground/80 pe-14 ps-14 transition-shadow focus:shadow-[0_0_0_1px_currentColor]",
                )}
                style={
                  fieldStyle === "underline"
                    ? undefined
                    : { borderRadius: fieldRadius }
                }
              />
              {isSearching ? (
                <Loader2
                  className={cn(
                    "absolute top-1/2 h-4 w-4 -translate-y-1/2 animate-spin opacity-60",
                    fieldStyle === "underline" ? "end-0" : "end-6",
                  )}
                  aria-hidden
                />
              ) : null}
            </label>
          </form>

          {trending.length > 0 && !typing ? (
            <div className="mx-auto mt-5 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {trendingLabel}
              </span>
              {trending.map((term) => (
                <Link
                  key={term}
                  href={`/${locale}/products?search=${encodeURIComponent(term)}`}
                  onClick={() => onOpenChange(false)}
                  className="transition-opacity hover:opacity-70"
                >
                  {term}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {typing ? (
          <section className="border-t px-4 py-6 sm:px-8" aria-busy={isSearching}>
            {correctedTo && suggestions.length > 0 ? (
              <p className="mb-4 text-center text-xs text-muted-foreground">
                {t.rich("common.showingResultsFor", {
                  query: correctedTo,
                  q: (chunks) => (
                    <strong className="font-semibold text-foreground">
                      {chunks}
                    </strong>
                  ),
                })}
              </p>
            ) : null}
            {suggestions.length > 0 ? (
              <ul
                className={cn(
                  "mx-auto grid max-w-5xl grid-cols-1 gap-1 transition-opacity sm:grid-cols-2",
                  isSearching && "opacity-60",
                )}
              >
                {suggestions.map((product) => {
                  const name = product.name || product.title || "Product";
                  return (
                    <li key={product._id}>
                      <Link
                        href={`/${locale}/products/${product.slug}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-4 rounded-lg p-2 transition-colors hover:bg-muted/60"
                      >
                        <span className="relative block h-14 w-14 shrink-0 overflow-hidden bg-muted/50">
                          {product.images?.[0] ? (
                            <AppImage
                              src={product.images[0]}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="56px"
                            />
                          ) : null}
                        </span>
                        <span className="truncate text-sm">{name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {isSearching ? t("common.loading") : t("common.noProductsFound")}
              </p>
            )}
          </section>
        ) : shelves && shelves.length > 0 ? (
          <div className="pb-8">
            {shelves.map((shelf) => (
              <section key={shelf.id} className="pt-2">
                <Link
                  href={`/${locale}/collections/${shelf.slug}`}
                  onClick={() => onOpenChange(false)}
                  className="mb-4 inline-block px-4 text-base transition-opacity hover:opacity-70 sm:px-10"
                >
                  {shelf.title}
                </Link>
                <ul className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {shelf.products.map((product) => (
                    <li
                      key={product._id}
                      className="shrink-0 snap-start basis-[46%] sm:basis-1/3 md:basis-1/4 lg:basis-1/6"
                    >
                      <Link
                        href={`/${locale}/products/${product.slug}`}
                        onClick={() => onOpenChange(false)}
                        className="group block bg-muted/50"
                      >
                        <span className="relative block aspect-square overflow-hidden">
                          {product.images?.[0] ? (
                            <AppImage
                              src={product.images[0]}
                              alt={product.name}
                              fill
                              className="object-contain p-6 transition-transform duration-500 group-hover:scale-[1.04]"
                              sizes="(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 46vw"
                            />
                          ) : null}
                        </span>
                        <span className="block px-2 pb-4 pt-1">
                          <span className="block truncate text-xs">
                            {product.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatProductPrice(product, formatPrice)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
