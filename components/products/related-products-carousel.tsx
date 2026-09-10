"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ModernProductCard,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { ProductQuickViewModal } from "@/components/products/product-quick-view-modal";
import { type Locale } from "@/config/i18n.config";
import { useTranslations } from "next-intl";

interface RelatedProductsCarouselProps {
  products: ModernProduct[];
  locale: Locale;
  title: string;
  /**
   * Header treatment only — the cards, the scroller and every behaviour
   * below are identical. "electronics" is the design the Electronics
   * template's `product-related` variant asks for: a centred two-tone
   * heading with the scroll controls on a hairline rule beneath it.
   */
  appearance?: "classic" | "electronics";
  /**
   * Section-level ad disclosure for a mixed rail. Optional: only a rail that
   * actually contains a paid card may claim to.
   */
  subtitle?: string;
}

// Show controls as soon as there is another related product to reveal.
const SCROLL_THRESHOLD = 1;

export function RelatedProductsCarousel({
  products,
  subtitle,
  locale,
  title,
  appearance = "classic",
}: RelatedProductsCarouselProps) {
  const t = useTranslations();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(
    null,
  );

  const showArrows = products.length > SCROLL_THRESHOLD;

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(left > 1);
    setCanScrollRight(left < max - 1);
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
  }, [updateScrollState]);

  if (!products.length) return null;

  // Drawn once and placed differently per appearance, so the two headers
  // can never drift apart on disabled state or labels.
  const arrows = showArrows ? (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full sm:h-9 sm:w-9"
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
        className="h-8 w-8 rounded-full sm:h-9 sm:w-9"
        onClick={() => scrollByAmount(1)}
        disabled={!canScrollRight}
        aria-label={t("home.scrollRight")}
      >
        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
      </Button>
    </div>
  ) : null;

  return (
    <div>
      {appearance === "electronics" ? (
        <div className="mb-6 sm:mb-8">
          <ElectronicsSectionHeading title={title} />
          {subtitle ? (
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          {/* The rule runs full width whether or not the arrows are there,
              so a short shelf and a long one share the same silhouette. */}
          <div className="mt-4 flex min-h-9 items-center justify-end border-b border-border pb-2">
            {arrows}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-6 sm:mb-8">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {arrows}
        </div>
      )}

      {/* Column-flow keeps the responsive card widths while preserving the
          horizontal scroller without an extra wrapper around each card. */}
      <div
        ref={scrollerRef}
        className="grid max-w-full auto-cols-[64%] grid-flow-col gap-4 overflow-x-auto overflow-y-hidden pb-2 scroll-smooth snap-x snap-mandatory sm:auto-cols-[calc((100%_-_1.25rem)_/_2)] sm:gap-5 md:auto-cols-[calc((100%_-_2.5rem)_/_3)] lg:auto-cols-[calc((100%_-_3.75rem)_/_4)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((product) => (
          <ModernProductCard
            key={product._id}
            product={product}
            locale={locale}
            showQuickView
            onQuickView={setQuickViewProduct}
            className="min-w-0 snap-start"
          />
        ))}
      </div>

      {/* One modal for the carousel — this used to be one per card. */}
      <ProductQuickViewModal
        product={quickViewProduct}
        locale={locale}
        open={!!quickViewProduct}
        onClose={() => setQuickViewProduct(null)}
      />
    </div>
  );
}
