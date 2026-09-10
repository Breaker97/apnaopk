"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export interface TopVendorCard {
  id: string;
  storeName: string;
  slug: string;
  tagline: string;
  logo: string;
  banner: string;
  /** Mean of approved product reviews; 0 when the store has none yet. */
  rating: number;
  reviewCount: number;
  /** Units in delivered sub-orders. */
  unitsSold: number;
  priceTier: string;
}

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
  vendors: TopVendorCard[];
  labels: TopVendorsLabels;
  className?: string;
}

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

export function HomeTopVendorsCarousel({
  locale,
  title,
  vendors,
  labels,
  className,
}: HomeTopVendorsCarouselProps) {
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

  if (!vendors.length) return null;

  return (
    <section className={cn("py-5 lg:py-8", className)}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-6">
          <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {title}
          </h2>
          {/* Pointer-only, like the other home rails. */}
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
        </div>

        <div
          ref={scrollerRef}
          className="mt-4 flex gap-3 overflow-x-auto pb-2 scroll-smooth sm:mt-8 sm:gap-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {vendors.map((vendor) => (
            <div
              key={vendor.id}
              className="shrink-0 basis-[60%] sm:basis-[48%] md:basis-[32%] lg:basis-[24%]"
            >
              <VendorCard vendor={vendor} locale={locale} labels={labels} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function VendorCard({
  vendor,
  locale,
  labels,
}: {
  vendor: TopVendorCard;
  locale: Locale;
  labels: TopVendorsLabels;
}) {
  const [isFavorite, setIsFavorite] = useState(false);

  const shopHref = useMemo(
    () => `/${locale}/vendors/${vendor.slug}`,
    [locale, vendor.slug],
  );

  const toggleFavorite = useCallback(() => {
    setIsFavorite((prev) => !prev);
  }, []);

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-border bg-card p-2 transition-shadow hover:shadow-md sm:p-3">
      <Link
        href={shopHref}
        className="relative block aspect-293/132 w-full overflow-hidden rounded-lg bg-muted sm:rounded-xl"
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

      <div className="relative px-0.5 pb-0.5 pt-7 sm:px-1 sm:pb-1 sm:pt-9">
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
            {vendor.tagline ? (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
                {vendor.tagline}
              </p>
            ) : null}
          </div>

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
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg bg-muted/40 py-2 text-center sm:mt-4 sm:rounded-xl sm:py-3">
          <Stat
            value={
              <span className="inline-flex items-center justify-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400 sm:h-3.5 sm:w-3.5" />
                {formatRating(vendor.rating)}
              </span>
            }
            label={labels.rating}
          />
          <Stat value={formatCount(vendor.unitsSold)} label={labels.sold} />
          <Stat value={vendor.priceTier} label={labels.price} />
        </div>

        <Button
          asChild
          className="mt-3 h-9 w-full rounded-full border border-transparent bg-foreground text-xs text-background hover:bg-foreground/90 dark:border-white/25 dark:bg-transparent dark:text-white dark:hover:border-white/40 dark:hover:bg-white/10 sm:mt-4 sm:h-11 sm:text-sm"
        >
          <Link href={shopHref}>{labels.goToShop}</Link>
        </Button>
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
