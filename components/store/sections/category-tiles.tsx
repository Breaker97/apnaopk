"use client";

import Link from "next/link";
import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { useRailEdges } from "@/components/store/scroll-rail";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { type Locale } from "@/config/i18n.config";
import {
  CATEGORY_MOBILE_SCALE,
  CATEGORY_SHAPE_RATIOS,
  CATEGORY_TABLET_WIDTH_SCALE,
  categoryRowScrolls,
  categoryTileBasis,
  categoryTileHref,
  type CategoryListStyle,
  type CategoryTile,
} from "@/lib/storefront/sections/category-list-style";
import { cn } from "@/lib/utils";

// Soft, theme-friendly background/foreground pairs for the monogram shown
// when a category has no image. Each category maps to a stable color derived
// from its name, so it looks intentional rather than "missing image".
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

function monogramColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length];
}

const TEXT_ALIGN_CLASS = { left: "text-left", center: "text-center", right: "text-right" } as const;
const JUSTIFY_CLASS = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;
const ITEMS_CLASS = { top: "items-start", center: "items-center", bottom: "items-end" } as const;

/**
 * The Category List block, drawn from its style: a titled row of category
 * tiles that wraps into a grid or scrolls sideways between arrows, each
 * tile a picture in a frame of the chosen shape with the name beneath,
 * above or over it. The block's templates are presets of the same style,
 * so every design the block offers — and every adjustment to one — comes
 * through here.
 *
 * Breakpoint values (tiles across, gaps, sizes) travel as CSS custom
 * properties, so the server markup never depends on the viewport and the
 * classes Tailwind must see stay static.
 */
export function CategoryTiles({
  locale,
  categories,
  style,
  title = "",
  activeSlug = null,
  linkTo,
  className,
}: {
  locale: Locale;
  categories: CategoryTile[];
  style: CategoryListStyle;
  /** The block's heading; empty draws none. */
  title?: string;
  /** The category the page is filtered to, ringed. */
  activeSlug?: string | null;
  /** Overrides the style's link target (the listing keeps shoppers on the listing). */
  linkTo?: CategoryListStyle["linkTo"];
  className?: string;
}) {
  const t = useTranslations();
  const trackRef = useRef<HTMLDivElement>(null);
  const { edges, measure } = useRailEdges(trackRef);

  const scrolls = categoryRowScrolls(style, categories.length);
  const phoneScrolls = style.mobileLayout === "scroll";
  const showArrows = scrolls && style.arrows !== "hidden";
  // A scroll row leaves a peek of the next tile only where nothing else
  // says the row continues; a wrapped row fits its columns exactly.
  const peek = scrolls && !showArrows;
  const target = linkTo ?? style.linkTo;

  const scrollBy = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * Math.max(track.clientWidth * 0.8, 200),
      behavior: "smooth",
    });
  }, []);

  const vars = {
    "--ct-gap": `${style.gap}px`,
    "--ct-gap-m": `${style.mobileGap}px`,
    "--ct-basis": categoryTileBasis(style.tileWidth, style.columns, style.gap, peek),
    "--ct-basis-t": categoryTileBasis(
      Math.round(style.tileWidth * CATEGORY_TABLET_WIDTH_SCALE),
      style.tabletColumns,
      style.gap,
      peek,
    ),
    "--ct-basis-m": categoryTileBasis(
      Math.round(style.tileWidth * CATEGORY_MOBILE_SCALE.width),
      style.mobileColumns,
      style.mobileGap,
      phoneScrolls,
    ),
    "--ct-h": `${style.tileHeight}px`,
    "--ct-h-m": `${Math.round(style.tileHeight * CATEGORY_MOBILE_SCALE.tile)}px`,
    "--ct-pad": `${style.imagePadding}px`,
    "--ct-pad-m": `${Math.round(style.imagePadding * CATEGORY_MOBILE_SCALE.tile)}px`,
    "--ct-text": `${style.textSize}px`,
    "--ct-text-m": `${Math.max(10, Math.round(style.textSize * CATEGORY_MOBILE_SCALE.text))}px`,
    "--ct-text-gap": `${style.textGap}px`,
  } as CSSProperties;

  const arrow = (direction: -1 | 1, hidden: boolean) => (
    <ArrowButton
      direction={direction}
      hidden={hidden}
      style={style}
      label={direction < 0 ? t("common.previous") : t("common.next")}
      onClick={() => scrollBy(direction)}
    />
  );

  const heading = title ? (
    style.titleStyle === "twoTone" ? (
      <ElectronicsSectionHeading
        title={title}
        className={style.titleAlign === "left" ? "text-left" : "text-center"}
      />
    ) : (
      <h2
        className={cn(
          "text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]",
          style.titleAlign === "center" && "text-center",
        )}
      >
        {title}
      </h2>
    )
  ) : null;
  const topArrows = showArrows && style.arrowPosition === "top";

  return (
    <div className={className} style={vars}>
      {heading || topArrows ? (
        <div
          className={cn(
            "mb-5 flex items-center gap-6 md:mb-7",
            style.titleAlign === "center" && !topArrows ? "justify-center" : "justify-between",
          )}
        >
          <div className={cn("min-w-0", style.titleAlign === "center" && topArrows && "flex-1")}>
            {heading}
          </div>
          {topArrows ? (
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              {arrow(-1, !edges.left)}
              {arrow(1, !edges.right)}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={cn("flex items-center", showArrows && style.arrowPosition === "sides" && "gap-2 md:gap-4")}>
        {showArrows && style.arrowPosition === "sides" ? arrow(-1, !edges.left) : null}
        <div
          ref={trackRef}
          data-rail={scrolls || phoneScrolls ? "" : undefined}
          onScroll={measure}
          className={cn(
            // One flex row throughout: it scrolls where the design scrolls
            // and wraps where it grids, and each tile's basis (a share of
            // the width, or a fixed width) sets the columns — so a row with
            // fewer tiles than columns can sit where the style says.
            "flex min-w-0 flex-1 gap-[var(--ct-gap-m)] md:gap-[var(--ct-gap)]",
            style.align === "center" ? "justify-center-safe" : "justify-start",
            // Phones: a swipeable row, or the row wrapped. From md: the
            // desktop layout, a wrapped row or one that scrolls with arrows.
            phoneScrolls
              ? "snap-x overflow-x-auto pb-2 scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "flex-wrap",
            phoneScrolls && !scrolls && "md:flex-wrap md:snap-none md:overflow-visible md:pb-0",
            !phoneScrolls &&
              scrolls &&
              "md:flex-nowrap md:snap-x md:overflow-x-auto md:pb-2 md:scroll-smooth md:[-ms-overflow-style:none] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden",
          )}
        >
          {categories.map((category) => (
            <Tile
              key={category.id}
              category={category}
              href={categoryTileHref(locale, category.slug, target)}
              style={style}
              active={activeSlug === category.slug}
            />
          ))}
        </div>
        {showArrows && style.arrowPosition === "sides" ? arrow(1, !edges.right) : null}
      </div>
    </div>
  );
}

function Tile({
  category,
  href,
  style,
  active,
}: {
  category: CategoryTile;
  href: string;
  style: CategoryListStyle;
  active: boolean;
}) {
  const over = style.textPosition === "over";
  const circle = style.shape === "circle";
  const frame: CSSProperties = {
    borderRadius: circle ? 9999 : style.roundness,
    aspectRatio: style.tileHeight > 0 ? undefined : CATEGORY_SHAPE_RATIOS[style.shape],
    backgroundColor: style.tileBackground || undefined,
    border:
      style.tileBorder && style.tileBorderWidth > 0
        ? `${style.tileBorderWidth}px solid ${style.tileBorder}`
        : undefined,
    boxShadow: style.tileShadow > 0 ? `0 8px ${style.tileShadow}px rgba(0,0,0,0.12)` : undefined,
  };

  const label = style.showText ? (
    <span
      className={cn(
        "line-clamp-2 min-w-0 text-[length:var(--ct-text-m)] leading-tight tracking-tight transition-colors md:text-[length:var(--ct-text)]",
        TEXT_ALIGN_CLASS[style.textAlign],
        style.textCase === "uppercase" && "uppercase tracking-[0.08em]",
        !style.textColor && (over ? "text-white drop-shadow-sm" : "text-foreground"),
        !over && "w-full",
      )}
      style={{ fontWeight: Number(style.textWeight), color: style.textColor || undefined }}
    >
      {category.name}
    </span>
  ) : null;

  const picture = category.image ? (
    style.imageFit === "cover" ? (
      <AppImage
        src={category.image}
        alt=""
        fill
        sizes={`(min-width: 1024px) ${Math.ceil(100 / style.columns)}vw, (min-width: 768px) ${Math.ceil(100 / style.tabletColumns)}vw, ${Math.ceil(100 / style.mobileColumns)}vw`}
        className={cn(
          "object-cover transition-transform duration-500",
          style.hover === "zoom" && "group-hover:scale-[1.05]",
        )}
      />
    ) : (
      // The inset IS the padding: an absolutely placed picture would
      // otherwise ignore any padding on its frame.
      <span className="absolute inset-[var(--ct-pad-m)] md:inset-[var(--ct-pad)]">
        <AppImage
          src={category.image}
          alt=""
          fill
          sizes="(min-width: 768px) 25vw, 50vw"
          className={cn(
            "object-contain transition-transform duration-300",
            style.hover === "zoom" && "group-hover:scale-[1.05]",
          )}
        />
      </span>
    )
  ) : (
    <Placeholder category={category} kind={style.placeholder} />
  );

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-w-0 shrink-0 snap-start flex-col [flex-basis:var(--ct-basis-m)] md:[flex-basis:var(--ct-basis-t)] lg:[flex-basis:var(--ct-basis)]",
        style.hover === "fade" && "transition-opacity hover:opacity-75",
      )}
      style={{ rowGap: over ? undefined : style.textGap }}
    >
      {style.textPosition === "above" ? label : null}
      <span
        className={cn(
          "relative block w-full overflow-hidden transition-[transform,box-shadow] duration-300",
          style.tileHeight > 0 && "h-[var(--ct-h-m)] md:h-[var(--ct-h)]",
          style.hover === "lift" && "group-hover:-translate-y-1 group-hover:shadow-lg",
          active && "ring-2 ring-inset ring-foreground",
        )}
        style={frame}
      >
        {picture}
        {style.hover === "darken" ? (
          <span
            aria-hidden
            className="absolute inset-0 bg-black opacity-0 transition-opacity duration-300 group-hover:opacity-20"
          />
        ) : null}
        {over && style.overlay > 0 ? (
          // Heaviest where the text sits, fading away from it, so the
          // picture stays a picture.
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(to ${style.textVertical === "top" ? "bottom" : "top"}, rgba(0,0,0,${style.overlay / 100}), rgba(0,0,0,${style.overlay / 300}) 50%, rgba(0,0,0,${style.overlay / 900}))`,
            }}
          />
        ) : null}
        {over && label ? (
          <span
            className={cn(
              "absolute inset-0 flex p-[var(--ct-text-gap)]",
              ITEMS_CLASS[style.textVertical],
              JUSTIFY_CLASS[style.textAlign],
            )}
          >
            {label}
          </span>
        ) : null}
      </span>
      {style.textPosition === "below" ? label : null}
    </Link>
  );
}

function Placeholder({ category, kind }: { category: CategoryTile; kind: CategoryListStyle["placeholder"] }) {
  if (kind === "none") return null;
  if (kind === "icon") {
    return (
      <span className="absolute inset-0 grid place-items-center">
        <Package className="h-8 w-8 text-muted-foreground" aria-hidden />
      </span>
    );
  }
  const color = monogramColor(category.name);
  const initial = category.name.trim() ? category.name.trim()[0].toUpperCase() : "?";
  return (
    <span className="absolute inset-0 grid place-items-center">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold transition-transform duration-300 group-hover:scale-105 sm:h-16 sm:w-16 sm:text-2xl",
          color.bg,
          color.fg,
        )}
      >
        {initial}
      </span>
    </span>
  );
}

function ArrowButton({
  direction,
  hidden,
  style,
  label,
  onClick,
}: {
  direction: -1 | 1;
  hidden: boolean;
  style: CategoryListStyle;
  label: string;
  onClick: () => void;
}): ReactNode {
  const Icon = direction < 0 ? ChevronLeft : ChevronRight;
  const sides = style.arrowPosition === "sides";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Side arrows stay in the layout with nothing to do, so the row does
      // not shift the moment a category is added; top arrows dim instead.
      disabled={!sides && hidden}
      className={cn(
        "hidden shrink-0 place-items-center transition-colors md:grid",
        style.arrows === "circle" &&
          "rounded-full bg-muted text-foreground/50 hover:bg-muted/70 hover:text-foreground",
        style.arrows === "square" &&
          "rounded-md border border-border bg-background text-foreground hover:bg-muted",
        style.arrows === "plain" && "text-foreground/60 hover:text-foreground",
        sides ? hidden && "invisible" : "disabled:opacity-40",
      )}
      style={{ width: style.arrowSize, height: style.arrowSize }}
    >
      <Icon style={{ width: style.arrowSize * 0.5, height: style.arrowSize * 0.5 }} />
    </button>
  );
}
