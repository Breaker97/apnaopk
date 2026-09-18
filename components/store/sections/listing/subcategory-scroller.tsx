"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { useRailEdges } from "@/components/store/scroll-rail";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";

interface ScrollerCategory {
  id: string;
  slug: string;
  name: string;
  image?: string;
}

/**
 * The design's department row: circular tiles between two round arrows.
 *
 * The arrows are the reason this is a client component — everything else
 * would render fine on the server, but a row that overflows without a way
 * to move it is the one thing the design does not do. Each one hides itself
 * once its side of the row is exhausted, so a store with four categories
 * shows no controls at all.
 *
 * Arrows are a pointer control, though: they only render from `sm`. What a
 * phone gets instead is the shared rail cue — `useRailEdges` stamps the same
 * measurement the arrows read onto the track, and globals.css fades whichever
 * edge still hides a department.
 */
export function SubcategoryScroller({
  locale,
  categories,
}: {
  locale: Locale;
  categories: ScrollerCategory[];
}) {
  const t = useTranslations();
  const trackRef = useRef<HTMLDivElement>(null);
  const { edges, measure } = useRailEdges(trackRef);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * Math.max(track.clientWidth * 0.8, 200),
      behavior: "smooth",
    });
  }, []);

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <ScrollButton
        direction="left"
        hidden={!edges.left}
        label={t("common.previous")}
        onClick={() => scrollBy(-1)}
      />
      {/* `justify-center-safe` is what the auto-margin wrapper used to fake:
          a short row centres, and an overflowing one falls back to start
          instead of pushing its first tile out of reach. */}
      <div
        ref={trackRef}
        data-rail
        onScroll={measure}
        className="flex flex-1 snap-x justify-center-safe gap-5 overflow-x-auto scroll-px-4 scroll-smooth pb-1 sm:gap-8 lg:gap-[38px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/${locale}/categories/${category.slug}`}
            // 112px tiles fitted two and a half departments on a 360px
            // screen — a row that looks half-empty and cut. At 84px three
            // sit whole with the fourth peeking, which is what reads as a
            // row that continues rather than one that ran out.
            className="group flex w-[84px] shrink-0 snap-start flex-col items-center gap-3 sm:w-[112px] md:w-[132px] lg:w-[152px] lg:gap-[15px]"
          >
            <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-full bg-muted transition-colors group-hover:bg-muted/70">
              {category.image ? (
                <AppImage
                  src={category.image}
                  alt=""
                  width={152}
                  height={152}
                  aria-hidden
                  className="h-[62%] w-[62%] object-contain transition-transform duration-300 group-hover:scale-[1.05]"
                  sizes="(min-width: 1024px) 152px, (min-width: 768px) 132px, (min-width: 640px) 112px, 84px"
                />
              ) : (
                <Package
                  className="h-8 w-8 text-muted-foreground"
                  aria-hidden
                />
              )}
            </span>
            {/* Two lines are reserved whether or not the name needs them,
                so one long department does not push its circle out of line
                with the rest of the row. */}
            <span className="line-clamp-2 text-center text-[13px] font-bold leading-[1.205] tracking-[-0.02em] text-foreground transition-colors [min-height:2lh] group-hover:text-primary sm:text-[15.66px]">
              {category.name}
            </span>
          </Link>
        ))}
      </div>
      <ScrollButton
        direction="right"
        hidden={!edges.right}
        label={t("common.next")}
        onClick={() => scrollBy(1)}
      />
    </div>
  );
}

function ScrollButton({
  direction,
  hidden,
  label,
  onClick,
}: {
  direction: "left" | "right";
  hidden: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Kept in the layout when it has nothing to do, so the row does not
      // shift sideways the moment a category is added.
      className={cn(
        "hidden size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground/50 transition-colors hover:bg-muted/70 hover:text-foreground sm:grid",
        hidden && "invisible",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}
