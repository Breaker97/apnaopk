"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import {
  ModernProductCard,
  ModernProductCardSkeleton,
  type ModernProduct,
} from "./modern-product-card";
import {
  CARD_GRID_GAP,
} from "@/components/store/product-grid-columns";

/** Cards on the first grid row are above the fold and eager-load their shot. */
const FIRST_ROW_CARDS = 4;

// Pulled in only once a shopper opens quick view, keeping the modal and its
// variant/cart dependencies out of the bundle every listing visit pays for.
const ProductQuickViewModal = dynamic(
  () =>
    import("./product-quick-view-modal").then((mod) => mod.ProductQuickViewModal),
  { ssr: false },
);

/**
 * How far ahead of the viewport the next page starts loading.
 *
 * Roughly one card row: far enough that the cards are usually rendered by the
 * time they are scrolled to, close enough that a fast flick through the grid
 * does not queue up pages nobody looks at.
 */
const PREFETCH_MARGIN = "600px 0px";

/**
 * Pages that load on scroll before the shopper has to ask for more.
 *
 * Uncapped infinite scroll makes the footer unreachable — every time it comes
 * into view another page pushes it back down — and leaves people with no sense
 * of how much catalogue is left. After this many automatic loads the button
 * takes over; each press grants the same budget again.
 */
const AUTO_LOAD_PAGES = 3;

/** One row of placeholders on the widest grid. */
const PENDING_PLACEHOLDERS = 4;

type ProductsApiResponse = {
  data?: {
    data?: ModernProduct[];
    pagination?: { page?: number; hasNext?: boolean; total?: number };
  };
};

interface ProductGridInfiniteProps {
  locale: Locale;
  /** The server-rendered page, already on screen. Never re-fetched. */
  initialProducts: ModernProduct[];
  /** Page number the server rendered — continuation starts at the next one. */
  initialPage: number;
  initialHasNext: boolean;
  /** Products the current filters match, for the progress readout. */
  total: number;
  /**
   * Query string for `/api/products`, without `page`. Also this component's
   * identity: the caller keys on it, so a filter change remounts against the
   * new server page instead of appending to results from the old filters.
   */
  query: string;
  /**
   * Real href of the next page, filters intact.
   *
   * The control is a link first and a loader second: to a crawler, and to a
   * browser whose JavaScript has not arrived or has failed, it is a working
   * route deeper into the catalogue. The click handler only takes over once
   * this page can actually append.
   */
  nextHref: string;
  /** Extra grid classes — a listing's column count, say. */
  className?: string;
}

/**
 * The products grid, continued on scroll.
 *
 * The first page is server-rendered and shipped as HTML — this component never
 * re-fetches it, so the grid stays indexable and its LCP image is in the
 * initial response. Everything past it is appended from `/api/products` as the
 * shopper approaches the end of what is loaded, which keeps the request that
 * paints the page at one page of products however deep they end up scrolling.
 */
export function ProductGridInfinite({
  locale,
  initialProducts,
  initialPage,
  initialHasNext,
  total,
  query,
  nextHref,
  className,
}: ProductGridInfiniteProps) {
  const t = useTranslations();

  const [products, setProducts] = useState(initialProducts);
  const [page, setPage] = useState(initialPage);
  const [hasNext, setHasNext] = useState(initialHasNext);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [autoBudget, setAutoBudget] = useState(AUTO_LOAD_PAGES);
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(
    null,
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // One request in flight at a time, cancelled on unmount. Guarded through a
  // ref rather than the `loading` state so the observer cannot fire a second
  // fetch in the frame before that state has re-rendered.
  const requestRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(
    async ({ automatic = false }: { automatic?: boolean } = {}) => {
      if (loadingRef.current || !hasNext) return;

      loadingRef.current = true;
      setLoading(true);
      setFailed(false);

      const controller = new AbortController();
      requestRef.current = controller;
      const nextPage = page + 1;

      try {
        const response = await fetch(`/api/products?${query}&page=${nextPage}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = (await response.json()) as ProductsApiResponse;
        const incoming = payload?.data?.data ?? [];
        const pagination = payload?.data?.pagination;

        setProducts((current) => {
          // A product added or re-sorted between requests can land on two
          // pages; React would then render duplicate keys and the shopper
          // would see the same card twice.
          const seen = new Set(current.map((product) => product._id));
          const arrivedOrganically = new Set(
            incoming
              .filter((product) => seen.has(product._id))
              .map((product) => product._id),
          );
          return [
            // An injected ad whose product now shows up as a genuine organic
            // result stops being an extra card. Clear the flag so it counts
            // toward the result total — otherwise it is excluded from the
            // count as an ad AND dropped from the incoming page as a
            // duplicate, so the grid under-reports it forever.
            ...current.map((product) =>
              product.sponsoredInjected && arrivedOrganically.has(product._id)
                ? { ...product, sponsoredInjected: false }
                : product,
            ),
            ...incoming.filter((product) => !seen.has(product._id)),
          ];
        });
        setPage(pagination?.page ?? nextPage);
        setHasNext(Boolean(pagination?.hasNext));
        // A run of automatic pages spends the budget and hands control back to
        // the button; pressing it buys the same run again.
        setAutoBudget((current) => (automatic ? current - 1 : AUTO_LOAD_PAGES));
      } catch (error) {
        // An abort is this component unmounting, not a failure to report.
        if ((error as Error)?.name === "AbortError") return;
        setFailed(true);
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [hasNext, page, query],
  );

  // Auto-loading stops after a failed request: retrying on scroll would hammer
  // a failing endpoint every time the sentinel drifted back into view.
  const autoLoads = hasNext && autoBudget > 0 && !failed;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !autoLoads) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore({ automatic: true });
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );

    // `loadMore` changes identity on every appended page, which rebuilds the
    // observer — and a fresh `observe()` reports the sentinel's current state.
    // Without that the run would stall: a sentinel that never left the viewport
    // emits no second intersection event of its own.
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoads, loadMore]);

  // Injected ads are extra cards, not results. Counting them made the grid
  // claim more matches than the filters found ("showing 5 of 5" beside a
  // sidebar reading "3 results").
  const loaded = products.filter((product) => !product.sponsoredInjected).length;
  // The server's total can trail a fast-moving catalogue; trust what is on
  // screen over a stale count rather than printing "showing 24 of 20".
  const knownTotal = Math.max(total, loaded);
  const progress = knownTotal > 0 ? Math.min(100, (loaded / knownTotal) * 100) : 0;
  const placeholders = Math.max(
    0,
    Math.min(PENDING_PLACEHOLDERS, knownTotal - loaded),
  );

  const showingCount = t("productsPage.showingCount", {
    shown: loaded,
    total: knownTotal,
  });

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          CARD_GRID_GAP,
          className,
        )}
      >
        {products.map((product, index) => (
          <ModernProductCard
            key={product._id}
            product={product}
            locale={locale}
            imagePriority={index < FIRST_ROW_CARDS}
            showQuickView
            onQuickView={setQuickViewProduct}
          />
        ))}

        {/* Placeholders sit inside the grid rather than under it, so the page
            grows by the height the arriving cards will occupy and nothing under
            the shopper's cursor jumps when they land. */}
        {loading
          ? Array.from({ length: placeholders }).map((_, index) => (
              <ModernProductCardSkeleton key={`pending-${index}`} />
            ))
          : null}
      </div>

      {/* Zero-height probe above the control. The observer must not watch the
          button itself: it moves down with every appended page, which would
          re-trigger it against the grid it just extended. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      <div className="mt-10 flex flex-col items-center gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {showingCount}
        </p>

        <div
          role="progressbar"
          aria-label={showingCount}
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-40 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {failed ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {t("productsPage.loadError")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadMore()}
            >
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : hasNext ? (
          <Button asChild variant="outline" size="lg" className="rounded-full px-8">
            <a
              href={nextHref}
              aria-disabled={loading}
              className={cn(loading && "pointer-events-none")}
              onClick={(event) => {
                // Only a plain left click is intercepted — ⌘/ctrl-click and
                // middle-click still open the next page in its own tab, which
                // is most of the reason this stayed an anchor.
                if (
                  event.defaultPrevented ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                ) {
                  return;
                }
                event.preventDefault();
                void loadMore();
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("productsPage.loadingMore")}
                </>
              ) : (
                t("productsPage.loadMore")
              )}
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("productsPage.endOfResults")}
          </p>
        )}
      </div>

      {quickViewProduct ? (
        <ProductQuickViewModal
          product={quickViewProduct}
          locale={locale}
          open
          onClose={() => setQuickViewProduct(null)}
        />
      ) : null}
    </>
  );
}
