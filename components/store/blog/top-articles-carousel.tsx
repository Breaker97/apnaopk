"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import {
  BlogArticleCard,
  type BlogArticleCardData,
} from "@/components/store/blog/blog-article-card";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";

export type TopArticle = BlogArticleCardData;

interface Props {
  articles: TopArticle[];
  locale: Locale;
  title: string;
  desktopColumns?: number;
  /** Electronics wears its two-tone heading treatment; other themes keep
   * the plain row title. Decided by the section definition from the active
   * theme, same as the compare page. */
  themedHeading?: boolean;
}

const DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:basis-[calc((100%_-_1.25rem)_/_2)]",
  3: "lg:basis-[calc((100%_-_2.5rem)_/_3)]",
  4: "lg:basis-[calc((100%_-_3.75rem)_/_4)]",
};

export function TopArticlesCarousel({
  articles,
  locale,
  title,
  desktopColumns = 4,
  themedHeading = false,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    4,
    Math.max(2, normalizedDesktopColumns),
  );

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
    const step = Math.max(320, Math.floor(el.clientWidth * 0.9));
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
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 sm:mb-7 sm:gap-4">
        {themedHeading ? (
          <ElectronicsSectionHeading
            title={title}
            className="text-left text-lg tracking-tight sm:text-2xl"
          />
        ) : (
          <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight text-foreground sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {title}
          </h2>
        )}
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            href={`/${locale}/blog`}
            className="group inline-flex items-center gap-1.5 text-xs font-semibold text-foreground transition-colors hover:text-primary sm:gap-3 sm:text-sm"
          >
            All Articles
            <MoveRight className="h-4 w-5 transition-transform group-hover:translate-x-1 sm:h-5 sm:w-8" strokeWidth={1.5} />
          </Link>
          <div className="hidden items-center gap-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full border-border/70 bg-background text-muted-foreground shadow-none hover:text-foreground"
              onClick={() => scrollByAmount(-1)}
              disabled={!canScrollLeft}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full border-border/70 bg-background text-muted-foreground shadow-none hover:text-foreground"
              onClick={() => scrollByAmount(1)}
              disabled={!canScrollRight}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        // The 78% card already says the row continues; snap is what makes a
        // swipe land on the next card instead of halfway into it. The arrows
        // are pointer-only, so on a phone this is the whole interaction.
        className="flex snap-x gap-3 overflow-x-auto scroll-px-4 pb-2 scroll-smooth sm:gap-4 [-ms-overflow-style:none] [scrollbar-width:none] lg:gap-5 [&::-webkit-scrollbar]:hidden"
      >
        {articles.map((a) => (
          <div
            key={a._id}
            className={cn(
              "shrink-0 snap-start basis-[78%] sm:basis-[48%]",
              DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
            )}
          >
            <BlogArticleCard article={a} locale={locale} />
          </div>
        ))}
      </div>
    </div>
  );
}
