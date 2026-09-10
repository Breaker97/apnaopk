"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface FeaturedCategory {
  id: string;
  name: string;
  slug: string;
  image?: string;
}

// Soft, theme-friendly background/foreground pairs for the monogram fallback
// shown when a category has no image. Each category maps to a stable color
// derived from its name, so it looks intentional rather than "missing image".
const MONOGRAM_COLORS = [
  { bg: "bg-rose-100 dark:bg-rose-500/20", fg: "text-rose-600 dark:text-rose-300" },
  { bg: "bg-orange-100 dark:bg-orange-500/20", fg: "text-orange-600 dark:text-orange-300" },
  { bg: "bg-amber-100 dark:bg-amber-500/20", fg: "text-amber-600 dark:text-amber-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/20", fg: "text-emerald-600 dark:text-emerald-300" },
  { bg: "bg-teal-100 dark:bg-teal-500/20", fg: "text-teal-600 dark:text-teal-300" },
  { bg: "bg-sky-100 dark:bg-sky-500/20", fg: "text-sky-600 dark:text-sky-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-500/20", fg: "text-indigo-600 dark:text-indigo-300" },
  { bg: "bg-violet-100 dark:bg-violet-500/20", fg: "text-violet-600 dark:text-violet-300" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-500/20", fg: "text-fuchsia-600 dark:text-fuchsia-300" },
  { bg: "bg-pink-100 dark:bg-pink-500/20", fg: "text-pink-600 dark:text-pink-300" },
];

// Stable hash so a given category name always resolves to the same color.
function monogramColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length];
}

// First letter (or first two chars for CJK-less short names), uppercased.
function monogramInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

interface HomeFeaturedCategoriesClientProps {
  locale: Locale;
  title: string;
  categories: FeaturedCategory[];
}

// Above this count the grid would wrap onto a second row, so we switch to a
// single-row horizontal slider with arrow controls instead.
const CAROUSEL_THRESHOLD = 8;

function CategoryCard({
  locale,
  category,
  className,
}: {
  locale: Locale;
  category: FeaturedCategory;
  className?: string;
}) {
  return (
    <Link
      href={`/${locale}/products?category=${category.slug}`}
      className={cn(
        "group flex flex-col items-center gap-1.5 sm:gap-3",
        className,
      )}
    >
      <div className="relative flex h-16 w-full items-center justify-center sm:h-25">
        {category.image ? (
          <AppImage
            src={category.image}
            alt={category.name}
            width={140}
            height={140}
            className="h-full w-auto max-w-[70%] object-contain transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          (() => {
            const color = monogramColor(category.name);
            return (
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold transition-transform duration-300 group-hover:scale-105 sm:h-16 sm:w-16 sm:text-2xl",
                  color.bg,
                  color.fg,
                )}
              >
                {monogramInitial(category.name)}
              </span>
            );
          })()
        )}
      </div>
      <span className="line-clamp-1 text-center text-[11px] font-semibold text-foreground sm:text-sm sm:font-bold">
        {category.name}
      </span>
    </Link>
  );
}

export function HomeFeaturedCategoriesClient({
  locale,
  title,
  categories,
}: HomeFeaturedCategoriesClientProps) {
  const t = useTranslations("home");
  const isCarousel = categories.length > CAROUSEL_THRESHOLD;

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
    const step = Math.max(280, Math.floor(el.clientWidth * 0.9));
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!isCarousel) return;
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
  }, [isCarousel, updateScrollState]);

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-6">
          <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {title}
          </h2>

          {isCarousel && (
            /* Pointer-only, like the product rails — the strip is swiped
               directly on touch. */
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
          )}
        </div>

        {isCarousel ? (
          <div
            ref={scrollerRef}
            className="mt-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 scroll-smooth sm:mt-6 sm:gap-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                locale={locale}
                category={category}
                className="shrink-0 snap-start basis-[22%] sm:basis-[22%] md:basis-[15.5%] lg:basis-[11.5%]"
              />
            ))}
          </div>
        ) : (
          /* Phones get a single scrolling row rather than the 4x2 grid, which
             cost ~120px of vertical space above the fold. The partly-visible
             fifth tile is what signals there is more to swipe to. The grid
             returns at `sm`, where two rows fit comfortably. */
          <div className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scroll-smooth sm:mt-6 sm:grid sm:grid-cols-4 sm:gap-6 sm:overflow-visible sm:pb-0 md:grid-cols-6 lg:grid-cols-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                locale={locale}
                category={category}
                className="w-[21%] shrink-0 snap-start sm:w-auto"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
