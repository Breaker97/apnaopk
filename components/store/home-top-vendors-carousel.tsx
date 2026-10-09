"use client";

import Link from "@/components/language/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Star,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { readableForegroundColor } from "@/lib/site-config/appearance-colors";
import type { TopVendorCard } from "@/lib/storefront/section-data/top-vendors";
import type { TopVendorsDisplay } from "@/lib/storefront/sections/top-vendors";

export type { TopVendorCard };

export interface TopVendorsLabels {
  rating: string;
  sold: string;
  price: string;
  goToShop: string;
  scrollLeft: string;
  scrollRight: string;
}

interface HomeTopVendorsCarouselProps {
  locale: Locale;
  title: string;
  subtitle?: string;
  viewAll?: { label: string; href: string };
  vendors: TopVendorCard[];
  labels: TopVendorsLabels;
  display: TopVendorsDisplay;
  className?: string;
}

const CARD_STYLE_CLASS: Record<TopVendorsDisplay["cardStyle"], string> = {
  bordered: "border border-border/40 hover:shadow-md",
  shadow: "border border-transparent shadow-md hover:shadow-lg",
  flat: "border border-transparent",
};

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return value.toLocaleString();
  return String(value);
}

function formatRating(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.0";
  return value.toFixed(1);
}

/**
 * Column counts as CSS variables: tablets never take more than three cards
 * a row, desktops take the merchant's count. The carousel turns them into
 * card widths, the grid into tracks, so one setting drives both layouts.
 */
function columnVars(columns: number): CSSProperties {
  return {
    "--tv-cols-md": Math.min(3, columns),
    "--tv-cols-lg": columns,
  } as CSSProperties;
}

export function HomeTopVendorsCarousel({
  locale,
  title,
  subtitle,
  viewAll,
  vendors,
  labels,
  display,
  className,
}: HomeTopVendorsCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isCarousel = display.layout === "carousel";

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
  }, [updateScrollState, isCarousel]);

  if (!vendors.length) return null;

  return (
    <section
      className={cn("py-5 lg:py-8", className)}
      style={
        display.backgroundColor
          ? { backgroundColor: display.backgroundColor }
          : undefined
      }
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {viewAll ? (
              <Link
                href={viewAll.href}
                className="whitespace-nowrap text-xs font-semibold text-primary hover:underline sm:text-sm"
              >
                {viewAll.label}
              </Link>
            ) : null}
            {/* Pointer-only, like the other home rails. A grid has nothing
                to scroll, so it has no arrows at all. */}
            {isCarousel ? (
              <div className="hidden items-center gap-2 [@media(hover:hover)]:flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full sm:h-9 sm:w-9"
                  onClick={() => scrollByAmount(-1)}
                  disabled={!canScrollLeft}
                  aria-label={labels.scrollLeft}
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
                  aria-label={labels.scrollRight}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {isCarousel ? (
          <div
            ref={scrollerRef}
            style={columnVars(display.desktopColumns)}
            className="mt-4 flex gap-3 overflow-x-auto pb-2 scroll-smooth sm:mt-8 sm:gap-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {vendors.map((vendor) => (
              <div
                key={vendor.id}
                // Each width leaves room for the gaps between the cards in
                // view (1.25rem from sm up), so N cards fill the row exactly.
                className="shrink-0 basis-[60%] sm:basis-[calc((100%_-_1.25rem)/2)] md:basis-[calc((100%_-_(var(--tv-cols-md)_-_1)*1.25rem)/var(--tv-cols-md))] lg:basis-[calc((100%_-_(var(--tv-cols-lg)_-_1)*1.25rem)/var(--tv-cols-lg))]"
              >
                <VendorCard
                  vendor={vendor}
                  locale={locale}
                  labels={labels}
                  display={display}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            style={columnVars(display.desktopColumns)}
            className="mt-4 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-5 md:grid-cols-[repeat(var(--tv-cols-md),minmax(0,1fr))] lg:grid-cols-[repeat(var(--tv-cols-lg),minmax(0,1fr))]"
          >
            {vendors.map((vendor) => (
              <VendorCard
                key={vendor.id}
                vendor={vendor}
                locale={locale}
                labels={labels}
                display={display}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VendorCard({
  vendor,
  locale,
  labels,
  display,
}: {
  vendor: TopVendorCard;
  locale: Locale;
  labels: TopVendorsLabels;
  display: TopVendorsDisplay;
}) {
  const [isFavorite, setIsFavorite] = useState(false);

  const shopHref = useMemo(
    () => `/${locale}/vendors/${vendor.slug}`,
    [locale, vendor.slug],
  );

  const toggleFavorite = useCallback(() => {
    setIsFavorite((prev) => !prev);
  }, []);

  const stats = [
    display.showRating && {
      key: "rating",
      label: labels.rating,
      value: (
        <span className="inline-flex items-center justify-center gap-1">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400 sm:h-3.5 sm:w-3.5" />
          {formatRating(vendor.rating)}
        </span>
      ),
    },
    display.showSold && {
      key: "sold",
      label: labels.sold,
      value: formatCount(vendor.unitsSold),
    },
    display.showPrice && {
      key: "price",
      label: labels.price,
      value: vendor.priceTier,
    },
  ].filter((stat) => stat !== false);

  // Inner corners follow the card's, a step tighter, so a square card does
  // not hold a rounded banner and a round one does not hold a sharp one.
  const radiusVars = {
    "--tv-radius": `${display.cardRadius}px`,
    "--tv-radius-inner": `${Math.round(display.cardRadius * 0.75)}px`,
  } as CSSProperties;

  const buttonColor = display.buttonColor;
  const buttonStyle: CSSProperties | undefined = buttonColor
    ? display.buttonStyle === "solid"
      ? {
          backgroundColor: buttonColor,
          borderColor: buttonColor,
          color: readableForegroundColor(buttonColor),
        }
      : { borderColor: buttonColor, color: buttonColor }
    : undefined;

  return (
    <article
      style={radiusVars}
      className={cn(
        "group relative flex h-full flex-col rounded-[var(--tv-radius)] bg-card p-2 transition-shadow sm:p-3",
        CARD_STYLE_CLASS[display.cardStyle],
      )}
    >
      <Link
        href={shopHref}
        className="relative block aspect-293/132 w-full overflow-hidden rounded-[var(--tv-radius-inner)] bg-muted"
        aria-label={vendor.storeName}
      >
        {vendor.banner ? (
          <AppImage
            src={vendor.banner}
            alt={vendor.storeName}
            fill
            sizes="(max-width: 768px) 60vw, 25vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-linear-to-br from-muted to-muted/40">
            <Store className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
      </Link>

      <div className="relative flex flex-1 flex-col px-0.5 pb-0.5 pt-7 sm:px-1 sm:pb-1 sm:pt-9">
        <div className="absolute -top-5 left-0.5 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-[3px] border-card bg-background shadow-sm sm:-top-6 sm:left-1 sm:h-12 sm:w-12 sm:border-4">
          {vendor.logo ? (
            <AppImage
              src={vendor.logo}
              alt={`${vendor.storeName} logo`}
              width={48}
              height={48}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-amber-400 text-sm font-bold text-black">
              {vendor.storeName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={shopHref}
              className="block truncate text-sm font-semibold text-foreground hover:underline sm:text-base"
            >
              {vendor.storeName}
            </Link>
            {display.showTagline && vendor.tagline ? (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
                {vendor.tagline}
              </p>
            ) : null}
          </div>

          {display.showFollow ? (
            <button
              type="button"
              onClick={toggleFavorite}
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors sm:h-8 sm:w-8",
                "hover:border-foreground/20 hover:text-foreground",
                isFavorite && "border-rose-200 bg-rose-50 text-rose-500",
              )}
              aria-label={
                isFavorite
                  ? `Unfavorite ${vendor.storeName}`
                  : `Favorite ${vendor.storeName}`
              }
              aria-pressed={isFavorite}
            >
              <Heart
                className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", isFavorite && "fill-current")}
              />
            </button>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div
            className="mt-3 grid divide-x divide-border rounded-[var(--tv-radius-inner)] bg-muted/40 py-2 text-center sm:mt-4 sm:py-3"
            style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
          >
            {stats.map((stat) => (
              <Stat key={stat.key} value={stat.value} label={stat.label} />
            ))}
          </div>
        ) : null}

        {display.showButton ? (
          <>
            {/* Takes the slack: the button keeps its gap below the stats and
                still sits at the bottom of a taller neighbour's row, so a
                row of cards lines its buttons up whatever each one shows. */}
            <div className="min-h-3 flex-1 sm:min-h-4" aria-hidden />
            <Button
              asChild
              style={buttonStyle}
              className={cn(
                "h-9 w-full rounded-full border text-xs sm:h-11 sm:text-sm",
                display.buttonStyle === "solid"
                  ? "border-transparent bg-foreground text-background hover:bg-foreground/90 dark:border-white/25 dark:bg-transparent dark:text-white dark:hover:border-white/40 dark:hover:bg-white/10"
                  : "border-foreground/70 bg-transparent text-foreground hover:bg-foreground/5",
                // An inline colour outranks the hover classes; dim it instead.
                buttonColor && "hover:opacity-90",
              )}
            >
              <Link href={shopHref}>{labels.goToShop}</Link>
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function Stat({
  value,
  label,
}: {
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-1 sm:px-2">
      <span className="text-xs font-semibold leading-none text-foreground sm:text-sm">
        {value}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
        {label}
      </span>
    </div>
  );
}
