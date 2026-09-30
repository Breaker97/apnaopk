"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  ModernProductCard,
  ModernProductCardSkeleton,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { Button } from "@/components/ui/button";
import { useWhenIdle } from "@/hooks/use-idle-preload";
import { useRailEdges } from "@/components/store/scroll-rail";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import { ElectronicsSectionHeading } from "./themes/electronics-section-heading";
import {
  CARD_SHELF_GAP,
  PRODUCT_SHELF_DESKTOP_COLUMN_CLASSES,
} from "@/components/store/product-grid-columns";

export interface ProductGroupTab {
  id: string;
  label: string;
  /** The first tab's, sent with the page; the others are fetched. */
  products?: ModernProduct[];
  /** The tab's GET /api/product-cards query string. */
  query: string;
}

async function fetchTabProducts(query: string): Promise<ModernProduct[]> {
  const response = await fetch(`/api/product-cards?${query}`);
  if (!response.ok) throw new Error(`product-cards ${response.status}`);
  const body = (await response.json()) as { data?: ModernProduct[] };
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * How the shelf is dressed. "standard" is the original left-heading /
 * right-tabs row; "centered" is the Electronics design — a centred two-tone
 * heading over a left-aligned rail on a hairline, with the shelf's scroll
 * controls parked at the rail's far end. Same data either way; this is the
 * presentational half of the section's variants.
 */
export type ProductGroupAppearance = "standard" | "centered";

/** Desktop shelf widths per visible-card count — shared with the new-arrivals shelf. */
const DESKTOP_COLUMN_CLASSES = PRODUCT_SHELF_DESKTOP_COLUMN_CLASSES;

/**
 * Client half of the tabbed product group. The first tab's products come with
 * the page; the other tabs' are fetched once the page is idle — so switching
 * is still instant by the time a shopper scrolls this far — or as soon as a
 * pointer, a touch or focus reaches a tab, if that comes first.
 */
export function ProductGroupTabs({
  locale,
  title,
  tabs,
  appearance = "standard",
  desktopColumns = 4,
}: {
  locale: Locale;
  title: string;
  tabs: ProductGroupTab[];
  appearance?: ProductGroupAppearance;
  /** Cards sharing the visible row from lg up (2-6); phones keep 2, sm 3. */
  desktopColumns?: number;
}) {
  const t = useTranslations();
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const [productsByTab, setProductsByTab] = useState<
    Record<string, ModernProduct[]>
  >(() =>
    Object.fromEntries(
      tabs.flatMap((tab) => (tab.products ? [[tab.id, tab.products]] : [])),
    ),
  );
  const [failedTabs, setFailedTabs] = useState<Set<string>>(new Set());
  const requestedRef = useRef(new Set<string>());

  const loadTab = useCallback((tab: ProductGroupTab) => {
    if (tab.products || requestedRef.current.has(tab.id)) return;
    requestedRef.current.add(tab.id);
    setFailedTabs((current) => {
      if (!current.has(tab.id)) return current;
      const next = new Set(current);
      next.delete(tab.id);
      return next;
    });
    fetchTabProducts(tab.query)
      .then((products) =>
        setProductsByTab((current) => ({ ...current, [tab.id]: products })),
      )
      .catch(() => {
        // Asked for again the next time the tab is reached for.
        requestedRef.current.delete(tab.id);
        setFailedTabs((current) => new Set(current).add(tab.id));
      });
  }, []);
  const loadAllTabs = useCallback(() => {
    for (const tab of tabs) loadTab(tab);
  }, [tabs, loadTab]);
  useWhenIdle(loadAllTabs);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The tab row scrolls once a merchant adds more tabs than fit. The arrows
  // beside it are pointer-only, so on a phone the fade is the only thing that
  // says the row continues — and it measures itself, so the common three-tab
  // shelf shows nothing at all.
  const tabRailRef = useRef<HTMLDivElement | null>(null);
  const { measure: measureTabRail } = useRailEdges(tabRailRef);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // The centered rail's pill is ONE element that slides between tabs, rather
  // than each tab painting its own — so a switch glides instead of snapping.
  // Null until measured: the server HTML paints the pill on the active tab.
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );

  // Same mechanics as the related-products shelf: step by one card plus the
  // gap so a click always lands on a card edge rather than mid-product.
  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < max - 1);
  }, []);

  const scrollByAmount = useCallback((direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const firstItem = el.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(window.getComputedStyle(el).columnGap || "0");
    const step = firstItem
      ? firstItem.getBoundingClientRect().width + gap
      : Math.floor(el.clientWidth * 0.7);
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollState();
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateScrollState);
    };
    // Re-measured when the tab changes: a shorter shelf can end scrollable
    // where the previous one was not.
  }, [updateScrollState, activeId]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const centered = appearance === "centered";
  const activeTabId = active?.id;

  useLayoutEffect(() => {
    const rail = tabRailRef.current;
    if (!centered || !rail || !activeTabId) return;
    const measure = () => {
      const tab = tabRefs.current.get(activeTabId);
      if (tab) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Web fonts landing and viewport changes both re-flow the labels.
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [centered, activeTabId]);

  if (!active) return null;
  const activeProducts = productsByTab[active.id];

  const safeDesktopColumns = Math.min(
    6,
    Math.max(
      2,
      Number.isFinite(desktopColumns) ? Math.floor(desktopColumns) : 4,
    ),
  );

  return (
    // No title: no top padding, so a Heading block above sits flush.
    <section className={title ? "py-5 lg:py-8" : "pb-5 lg:pb-8"}>
      <div className="container mx-auto px-4">
        <div
          className={cn(
            centered
              ? "flex flex-col items-center gap-5"
              : "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
          )}
        >
          {title ? (
            centered ? (
              <ElectronicsSectionHeading title={title} />
            ) : (
              <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
                {title}
              </h2>
            )
          ) : null}

          {/* The rail: tabs on the leading edge, scroll controls at the far
              end. */}
          <div
            className={cn(
              centered &&
                "flex w-full items-center justify-between gap-6 py-1.5",
            )}
          >
            <div
              role="tablist"
              ref={tabRailRef}
              data-rail
              onScroll={measureTabRail}
              className={cn(
                "flex items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                // Every centered tab carries the pill's padding, so the
                // labels hold still while the pill moves; the padding IS the
                // spacing between them.
                centered ? "relative min-w-0" : "gap-2 pb-1",
              )}
            >
              {centered && pill ? (
                <span
                  aria-hidden
                  // Positioned by the inline transform alone: Tailwind's
                  // translate utilities write the separate `translate`
                  // property, which would stack on top of it.
                  className="pointer-events-none absolute left-0 top-1/2 h-[37.5px] rounded-button bg-foreground transition-[transform,width] duration-300 ease-out motion-reduce:transition-none"
                  style={{
                    width: pill.width,
                    transform: `translate(${pill.left}px, -50%)`,
                  }}
                />
              ) : null}
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  ref={(node) => {
                    if (node) tabRefs.current.set(tab.id, node);
                    else tabRefs.current.delete(tab.id);
                  }}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === active.id}
                  onPointerEnter={() => loadTab(tab)}
                  onPointerDown={() => loadTab(tab)}
                  onFocus={() => loadTab(tab)}
                  onClick={() => {
                    loadTab(tab);
                    setActiveId(tab.id);
                  }}
                  className={cn(
                    "shrink-0 transition-colors",
                    centered
                      ? cn(
                          // The design dresses only the ACTIVE tab as a
                          // button (theme radius); the rest sit bare on the
                          // hairline rail — and they stay near-black, not
                          // muted, so the row reads as a set of choices
                          // rather than one live and six dead.
                          "relative h-[37.5px] rounded-button px-4 text-[15.4px] duration-300 motion-reduce:transition-none sm:px-6",
                          tab.id === active.id
                            ? cn(
                                "font-bold text-background",
                                // Before the pill is measured (the server
                                // render), the tab paints its own.
                                !pill && "bg-foreground",
                              )
                            : "font-semibold text-foreground hover:opacity-70",
                        )
                      : cn(
                          "rounded-button border px-4 py-1.5 text-sm font-medium",
                          tab.id === active.id
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        ),
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {centered ? (
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => scrollByAmount(-1)}
                  disabled={!canScrollLeft}
                  aria-label={t("home.scrollLeft")}
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => scrollByAmount(1)}
                  disabled={!canScrollRight}
                  aria-label={t("home.scrollRight")}
                >
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          ref={scrollerRef}
          className={cn(
            // 45%, not two exact halves: at exactly half a width the shelf
            // ends flush with the second card and an eight-product row looks
            // like a two-product row — there are no arrows on a phone to say
            // otherwise. The sliver of the third card is the cue. From `sm`
            // the designed three-across returns, with the arrows to match.
            "mt-6 grid snap-x snap-mandatory grid-flow-col auto-cols-[45%] overflow-x-auto pb-2 sm:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem)_*_2)_/_3)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            CARD_SHELF_GAP,
            DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {activeProducts
            ? activeProducts.map((product) => (
                <div key={product._id} className="snap-start">
                  <ModernProductCard product={product} locale={locale} />
                </div>
              ))
            : failedTabs.has(active.id)
              ? null
              : Array.from({ length: safeDesktopColumns }, (_, index) => (
                  <ModernProductCardSkeleton key={index} />
                ))}
        </div>
        {!activeProducts && failedTabs.has(active.id) ? (
          <div className="flex justify-center py-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadTab(active)}
            >
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
