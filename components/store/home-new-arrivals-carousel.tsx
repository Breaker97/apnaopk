"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/config/i18n.config";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModernProductCard, type ModernProduct } from "@/components/products/modern-product-card";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { useTranslations } from "next-intl";
import {
  CARD_SHELF_GAP,
  PRODUCT_SHELF_DESKTOP_COLUMN_CLASSES,
} from "@/components/store/product-grid-columns";

// Loaded only when a shopper opens quick view, keeping the modal and its deps
// out of the initial section bundle.
const ProductQuickViewModal = dynamic(
  () =>
    import("@/components/products/product-quick-view-modal").then(
      (mod) => mod.ProductQuickViewModal,
    ),
  { ssr: false },
);

interface HomeNewArrivalsCarouselProps {
  products: ModernProduct[];
  locale: Locale;
  title?: string;
  subtitle?: string;
  desktopColumns?: number;
  viewAllHref?: string;
  className?: string;
  /** Electronics wears its two-tone heading treatment; other themes keep
   * the plain row title. Decided by the section definition from the active
   * theme, same as the compare page. */
  themedHeading?: boolean;
}

const DESKTOP_COLUMN_CLASSES = PRODUCT_SHELF_DESKTOP_COLUMN_CLASSES;

export function HomeNewArrivalsCarousel({
  products,
  locale,
  title = "New Arrivals",
  subtitle = "",
  desktopColumns = 4,
  viewAllHref,
  className,
  themedHeading = false,
}: HomeNewArrivalsCarouselProps) {
  const t = useTranslations("home");
  const tCommon = useTranslations("common");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(null);
  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    6,
    Math.max(2, normalizedDesktopColumns),
  );

  const handleQuickView = useCallback((product: ModernProduct) => {
    setQuickViewProduct(product);
  }, []);

  const handleCloseModal = useCallback(() => {
    setQuickViewProduct(null);
  }, []);

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(left > 1);
    setCanScrollRight(left < max - 1);
  }, []);

  const scrollByAmount = useCallback(
    (direction: -1 | 1) => {
      const el = scrollerRef.current;
      if (!el) return;
      const step = Math.max(320, Math.floor(el.clientWidth * 0.9));
      el.scrollBy({ left: direction * step, behavior: "smooth" });
    },
    []
  );

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
  }, [updateScrollState]);

  if (!products.length) return null;

  return (
    // With no title of its own the shelf drops its top padding: a Heading
    // block above it is then its heading, with nothing between the two.
    <section className={cn(title || subtitle ? "py-5 lg:py-8" : "pb-5 lg:pb-8", className)}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-6">
          <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {themedHeading ? (
              <ElectronicsSectionHeading
                as="span"
                title={title}
                className="text-left text-lg tracking-tight sm:text-2xl"
              />
            ) : (
              <span className="text-foreground">{title}</span>
            )}{" "}
            <span className="font-medium text-muted-foreground">{subtitle}</span>
          </h2>
          {/* Arrows do nothing for a thumb — the rail is swiped directly — so
              they are limited to devices with a real pointer, and touch gets a
              "view all" link in the space they leave behind. */}
          <div className="hidden items-center gap-2 [@media(hover:hover)]:flex">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full sm:h-9 sm:w-9"
              onClick={() => scrollByAmount(-1)}
              disabled={!canScrollLeft}
              aria-label={t("scrollLeft")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full sm:h-9 sm:w-9"
              onClick={() => scrollByAmount(1)}
              disabled={!canScrollRight}
              aria-label={t("scrollRight")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary hover:underline [@media(hover:hover)]:hidden"
            >
              {tCommon("viewAll")}
            </Link>
          )}
        </div>

        {/* Column-flow keeps the responsive card widths while preserving the
            horizontal scroller without an extra wrapper around each card.
            On phones the cards are sized so the next one is partly visible —
            that sliver is the cue that the rail scrolls. Bleeding to the
            viewport edge lets it scroll out of the container's gutter rather
            than stopping short of it. */}
        <div
          ref={scrollerRef}
          className={cn(
            "mt-4 grid snap-x snap-mandatory auto-cols-[42%] grid-flow-col overflow-x-auto pb-2 scroll-smooth sm:mt-8 sm:auto-cols-[48%] md:auto-cols-[32%] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            CARD_SHELF_GAP,
            DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {products.map((product) => (
            <ModernProductCard
              key={product._id}
              product={product}
              locale={locale}
              onQuickView={handleQuickView}
              className="min-w-0 snap-start"
            />
          ))}
        </div>

        {quickViewProduct && (
          <ProductQuickViewModal
            product={quickViewProduct}
            locale={locale}
            open
            onClose={handleCloseModal}
          />
        )}
      </div>
    </section>
  );
}
