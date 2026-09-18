"use client";

import { MapPin, Star } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { CardBrandLogo } from "@/components/products/card-brand-logo";
import { cn } from "@/lib/utils";
import {
  cardButtonCss,
  cardChromeCss,
  cardDiscountChipCss,
  cardPreviewStageCss,
  cardTypographyCss,
  visibleProductCardGroups,
  productCardElementOn,
  type ProductCardConfig,
  type ProductCardElement,
} from "@/lib/products/product-card-config";

/**
 * The configurator's live "Card Preview": a static mock product rendered
 * with EXACTLY the config semantics of the storefront card
 * (components/products/modern-product-card.tsx) — same element vocabulary,
 * same docked-vs-full rating rule, same stage/price/button/chrome rules —
 * minus the interactive machinery (cart, wishlist, links) that needs store
 * providers. Also renders the template tiles inside the Card Templates
 * dialog. Any rule added to the card must land here too, or the preview
 * lies.
 */

const MOCK = {
  brand: "Prada",
  seller: "Acme",
  name: "Aurora Runner 2 Limited Edition",
  category: "Sneakers",
  price: "$999.00",
  compareAt: "$1,299.99",
  discount: 10,
  rating: 4.5,
  reviewCount: 350,
  soldCount: 3,
  variantTotal: 12,
  swatches: ["#18181b", "#ea580c", "#9ca3af", "#e5e7eb"],
  delivery: "$6.67 delivery Aug 17-21",
};

/** English fallbacks for the action button; the builder overlays i18n. */
const ACTION_LABELS = {
  "add-to-cart": "Add to Cart",
  view: "View",
  "quick-view": "Quick view",
} as const;

export function ProductCardPreview({
  config,
  brand = null,
  outOfStock = true,
  hasOptions = false,
  actionLabels = ACTION_LABELS,
  chooseOptionsLabel = "Choose options",
  className,
}: {
  config: ProductCardConfig;
  /**
   * One of the store's own brands, when one has a logo: the Brand element
   * then previews a real logo at the real size limit rather than a stand-in.
   */
  brand?: { name: string; logo: string } | null;
  /** The mock is out of stock so the Stock element has something to show. */
  outOfStock?: boolean;
  /**
   * Mock a product with variants: the storefront cannot add one without a
   * choice, so its Add to cart button reads "Choose options" and opens the
   * picker — whatever label the merchant typed.
   */
  hasOptions?: boolean;
  /** Default wording per action, when the merchant typed none. */
  actionLabels?: Record<ProductCardConfig["action"]["cart"], string>;
  chooseOptionsLabel?: string;
  className?: string;
}) {
  const vis = config.visibility;
  const style = config.style;
  const typography = style.typography;
  const groups = visibleProductCardGroups(config.groups);
  const priceOn = productCardElementOn(config.groups, "price");
  const contained = style.previewFit === "contain";
  const variantExtra = MOCK.variantTotal - MOCK.swatches.length;

  const minimizedRating = (
    <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
      <Star
        className={cn(
          "h-3.5 w-3.5",
          style.ratingColor ? "fill-current" : "fill-amber-400 text-amber-400",
        )}
        style={style.ratingColor ? { color: style.ratingColor } : undefined}
      />
      <span className="font-medium text-foreground">
        {MOCK.rating.toFixed(1)}
      </span>
    </span>
  );

  const renderElement = (key: ProductCardElement): React.ReactNode => {
    switch (key) {
      case "preview": {
        const image = (
          <AppImage
            src="/product-card-shoe.png"
            alt={MOCK.name}
            fill
            sizes="360px"
            className={cn(
              contained ? "object-contain" : "object-cover",
              style.previewHover === "zoom" &&
                "transition-transform duration-500 group-hover:scale-105",
            )}
          />
        );
        return (
          <div
            key={key}
            className={cn(
              "relative overflow-hidden ring-1 ring-black/5 dark:ring-white/10",
              !style.previewBackground && "bg-[#f3f4f6] dark:bg-zinc-800/50",
            )}
            style={cardPreviewStageCss(style)}
          >
            {contained ? (
              <div
                className="absolute inset-0"
                style={{ padding: style.previewPadding }}
              >
                <div className="relative h-full w-full">{image}</div>
              </div>
            ) : (
              image
            )}
            {vis.discountChipOnImage && (
              <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-semibold text-destructive shadow-sm ring-1 ring-black/5 dark:bg-muted dark:font-bold dark:text-red-400 dark:ring-white/10">
                -{MOCK.discount}%
              </span>
            )}
          </div>
        );
      }

      case "swatch":
        return (
          <div key={key} className="flex items-center gap-1 px-0.5">
            {MOCK.swatches.map((color) => (
              <span
                key={color}
                className={cn(
                  "h-4 w-4 rounded-full",
                  color === "#e5e7eb" ? "border border-border" : "border-0",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
            {vis.variantCount && variantExtra > 0 && (
              <span className="ps-0.5 text-xs font-semibold text-sky-600">
                +{variantExtra}
              </span>
            )}
          </div>
        );

      case "brand":
        if (style.brandDisplay !== "logo") {
          return (
            <p
              key={key}
              className="truncate px-0.5 text-xs font-semibold text-foreground"
              style={cardTypographyCss(typography.brand)}
            >
              {brand?.name ?? MOCK.brand}
            </p>
          );
        }
        // The store's own logo through the storefront's own component, so
        // the preview stops growing exactly where the card does.
        if (brand?.logo) {
          return (
            <CardBrandLogo
              key={key}
              src={brand.logo}
              name={brand.name}
              height={style.brandLogoHeight}
            />
          );
        }
        // No brand logo uploaded yet: a wordmark drawn as a scalable image of
        // a typical logo's proportions, bound by the same height and width
        // rules — a text stand-in grew without limit where a logo cannot.
        return (
          <span key={key} className="block px-0.5" style={{ height: style.brandLogoHeight }}>
            <svg
              viewBox="0 0 120 20"
              role="img"
              aria-label={MOCK.brand}
              className="h-full w-auto max-w-full text-foreground"
            >
              <text
                x="0"
                y="17"
                fontSize="21"
                fontFamily="Georgia, 'Times New Roman', serif"
                fontWeight="700"
                textLength="120"
                lengthAdjust="spacingAndGlyphs"
                fill="currentColor"
              >
                {MOCK.brand.toUpperCase()}
              </text>
            </svg>
          </span>
        );

      case "seller":
        return (
          <p
            key={key}
            className="truncate px-0.5 text-xs font-semibold text-foreground"
            style={cardTypographyCss(typography.seller)}
          >
            {MOCK.seller}
          </p>
        );

      case "name":
        return (
          <h3
            key={key}
            className="line-clamp-2 px-0.5 text-[13px] font-semibold leading-tight text-foreground sm:text-sm"
            style={cardTypographyCss(typography.product)}
          >
            {MOCK.name}
          </h3>
        );

      case "category":
        return (
          <p
            key={key}
            className="truncate px-0.5 text-xs leading-snug text-muted-foreground"
            style={cardTypographyCss(typography.category)}
          >
            {MOCK.category}
          </p>
        );

      case "price":
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-2 px-0.5 pt-1"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "whitespace-nowrap text-sm font-bold leading-snug tabular-nums",
                  style.pricePill
                    ? "inline-flex items-center rounded-[6px] border-2 border-emerald-500 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400"
                    : "text-foreground",
                )}
                style={cardTypographyCss(typography.price)}
              >
                {MOCK.price}
              </span>
              <span
                className="whitespace-nowrap text-[11px] text-muted-foreground line-through sm:text-sm"
                style={cardTypographyCss(typography.discounted)}
              >
                {MOCK.compareAt}
              </span>
              {vis.discountChip && (
                <span
                  className={cn(
                    "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold",
                    !style.discountChipBackground &&
                      "bg-rose-100 dark:bg-rose-500/15",
                    !style.discountChipColor &&
                      "text-rose-600 dark:text-rose-300",
                  )}
                  style={cardDiscountChipCss(style)}
                >
                  {MOCK.discount}% OFF
                </span>
              )}
            </div>
            {vis.ratingMinimized ? minimizedRating : null}
          </div>
        );

      case "rating": {
        if (vis.ratingMinimized) {
          return priceOn ? null : (
            <div key={key} className="px-0.5">
              {minimizedRating}
            </div>
          );
        }
        const ratio = MOCK.rating / 5;
        return (
          <div
            key={key}
            className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground"
          >
            <span className="relative inline-flex" aria-hidden="true">
              <span className="flex">
                {Array.from({ length: 5 }, (_, index) => (
                  <Star
                    key={index}
                    className="h-3.5 w-3.5 fill-muted text-muted-foreground/40"
                  />
                ))}
              </span>
              <span
                className="absolute inset-y-0 left-0 flex overflow-hidden"
                style={{ width: `${ratio * 100}%` }}
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <Star
                    key={index}
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      style.ratingColor
                        ? "fill-current"
                        : "fill-amber-400 text-amber-400",
                    )}
                    style={
                      style.ratingColor
                        ? { color: style.ratingColor }
                        : undefined
                    }
                  />
                ))}
              </span>
            </span>
            {vis.ratingCount && <span>({MOCK.reviewCount})</span>}
            {vis.itemSold && (
              <span className="border-s border-border ps-2">
                {MOCK.soldCount} sold
              </span>
            )}
          </div>
        );
      }

      case "delivery":
        return (
          <div
            key={key}
            className="flex items-center gap-1 px-0.5 text-[11px] text-muted-foreground sm:text-xs"
          >
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{MOCK.delivery}</span>
          </div>
        );

      case "stock":
        if (!outOfStock) return null;
        return (
          <div
            key={key}
            className={cn(
              "flex items-center justify-center px-3 py-2 text-xs font-semibold",
              !style.stockBackground &&
                "bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400",
            )}
            style={{
              backgroundColor: style.stockBackground || undefined,
              borderRadius: style.stockRadius,
              border:
                style.stockBorderWidth > 0 && style.stockBorder
                  ? `${style.stockBorderWidth}px solid ${style.stockBorder}`
                  : undefined,
              ...cardTypographyCss(typography.stock),
            }}
          >
            Out of Stock
          </div>
        );

      case "cart":
        if (!vis.cartButtonAlways) return null;
        return (
          <span
            key={key}
            className={cn(
              "flex h-10 w-full items-center justify-center gap-1.5 text-xs font-semibold",
              style.cartVariant === "outline"
                ? "text-foreground"
                : cn(
                    !style.cartBackground && "bg-foreground text-background",
                    style.cartBackground && "text-white",
                  ),
            )}
            style={cardButtonCss(style)}
          >
            {config.action.cart === "add-to-cart" && hasOptions
              ? chooseOptionsLabel
              : config.action.label.trim() || actionLabels[config.action.cart]}
          </span>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={cn("group flex flex-col", className)}
      style={{ gap: style.groupGap, ...cardChromeCss(style) }}
    >
      {groups.map((keys, index) => {
        const children = keys
          .map((elementKey) => renderElement(elementKey))
          .filter(Boolean);
        if (children.length === 0) return null;
        const pinned =
          index === groups.length - 1 &&
          keys.length === 1 &&
          keys[0] === "cart";
        return (
          <div
            key={index}
            className={cn("flex flex-col", pinned && "mt-auto")}
            style={{ gap: style.itemGap }}
          >
            {children}
          </div>
        );
      })}
    </div>
  );
}
