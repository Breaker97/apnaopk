"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import type { StorefrontLook } from "@/lib/storefront/storefront-looks";

export type LooksShape = "portrait" | "square" | "tall" | "landscape";

/** CSS `aspect-ratio` per shape. */
const SHAPE_RATIOS: Record<LooksShape, string> = {
  portrait: "4 / 5",
  square: "1 / 1",
  tall: "2 / 3",
  landscape: "4 / 3",
};

/**
 * "More Looks to Love": a swipeable row of Looks — the campaign image with
 * the Look's name beneath it, each opening the Look's collection page. Same
 * scroller as the category and product rails: arrows for pointers, a plain
 * swipe on touch.
 */
export function LooksList({
  locale,
  title,
  looks,
  layout,
}: {
  locale: Locale;
  title: string;
  looks: StorefrontLook[];
  /** The row's geometry on desktop (see the section's fields). */
  layout: {
    /** Looks across. */
    columns: number;
    /** px between them. */
    gap: number;
    shape: LooksShape;
    /** A CSS length. */
    radius: string;
  };
}) {
  const t = useTranslations("home");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
    const step = Math.max(280, Math.floor(el.clientWidth * 0.9));
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

  return (
    // No title: no top padding, so a Heading block above sits flush.
    <section className={title ? "py-5 lg:py-8" : "pb-5 lg:pb-8"}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-6">
          {title ? (
            <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {/* Pointer-only, like the product rails — the strip is swiped
              directly on touch. */}
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
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
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
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="mt-4 flex snap-x snap-mandatory gap-[var(--lk-gap)] overflow-x-auto pb-2 scroll-smooth sm:mt-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={
            {
              "--lk-gap": `${layout.gap}px`,
              // N Looks and the N-1 gaps between them fill the row exactly.
              "--lk-basis": `calc((100% - ${layout.gap}px * ${Math.max(0, layout.columns - 1)}) / ${layout.columns})`,
              "--lk-radius": layout.radius,
            } as React.CSSProperties
          }
        >
          {looks.map((look) => (
            <Link
              key={look.id}
              href={`/${locale}/collections/${look.slug}`}
              className="group flex shrink-0 snap-start basis-[72%] flex-col gap-3 sm:basis-[46%] md:basis-[31%] lg:[flex-basis:var(--lk-basis)]"
            >
              <span
                className="relative block overflow-hidden rounded-[var(--lk-radius)] bg-muted"
                style={{ aspectRatio: SHAPE_RATIOS[layout.shape] ?? SHAPE_RATIOS.portrait }}
              >
                <AppImage
                  src={look.image}
                  alt={look.title}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 72vw"
                />
              </span>
              <span className="line-clamp-1 text-sm font-medium text-foreground">
                {look.title}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
