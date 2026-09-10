"use client";

/**
 * A faithful, presentational replica of the storefront product card
 * (`components/products/modern-product-card.tsx`) for the AI Image Studio.
 *
 * It reproduces the real card's layout and hover behavior — colour swatches,
 * discount badge, the "Add to Cart" / "Choose options" + "Quick view" hover row,
 * price pill, rating — driven by the product the vendor is editing, so they can
 * see exactly how their card will look. Anything the product lacks (no price,
 * no colours, single vs. multi variant) simply renders the way the storefront
 * would, so the preview stays honest.
 *
 * The real card is not reused directly because it wraps everything in a `Link`
 * (navigating away would destroy the studio's unsaved work) and its buttons add
 * to cart / toggle the wishlist. Here the buttons are visual only; hover still
 * reveals them via the same `group-hover` mechanics as production.
 */

import { useTranslations } from "next-intl";
import { Heart, Maximize2, ShoppingBag, Star } from "lucide-react";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import {
  formatProductCompareAtPrice,
  formatProductPrice,
  getProductDiscountPercentage,
  productRequiresVariantSelection,
} from "@/lib/products/price-display";
import { getSwatchColor } from "@/lib/products/color-swatch";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type StudioPreviewColor = { value: string; colorCode?: string };

/** The product fields the storefront-card preview renders. */
export type StudioPreviewProduct = {
  name?: string;
  price?: number;
  comparePrice?: number;
  /** Variant prices — drive the price range and "Choose options" vs "Add to Cart". */
  variants?: { price?: number; comparePrice?: number }[];
  /** Values of the product's colour option, if it has one. */
  colors?: StudioPreviewColor[];
  featured?: boolean;
  rating?: number;
  reviewCount?: number;
};

type StorefrontCardPreviewProps = {
  /** The image currently on the studio stage ("" / null shows the fallback). */
  imageUrl?: string | null;
  alt?: string;
  product: StudioPreviewProduct;
};

export function StorefrontCardPreview({
  imageUrl,
  alt,
  product,
}: StorefrontCardPreviewProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const tf = useFallbackTranslator(t);

  const summary = {
    price: product.price,
    comparePrice: product.comparePrice,
    variants: product.variants,
  };
  const priceLabel = formatProductPrice(summary, formatPrice);
  const compareAtLabel = formatProductCompareAtPrice(summary, formatPrice);
  const discountPercentage = getProductDiscountPercentage(summary);
  const needsVariantSelection = productRequiresVariantSelection(summary);

  const colors = (product.colors || []).slice(0, 5);
  const selectedColorName = colors[0]?.value;
  const showRating = (product.reviewCount ?? 0) > 0;

  const actionLabel = needsVariantSelection
    ? tf("product.chooseOptions", "Choose options")
    : tf("common.addToCart", "Add to Cart");

  return (
    <div className="group">
      <div className="block space-y-3">
        {/* Image — same frame and hover zoom as the storefront card. */}
        <div className="relative aspect-square overflow-hidden rounded-md bg-[#f3f4f6] ring-1 ring-black/5 dark:bg-zinc-800/50 dark:ring-white/10">
          {imageUrl ? (
            // Plain img (not next/image) so the preview needs no loader/host
            // config; object-cover matches the real card's crop.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={alt || product.name || "Product image"}
              draggable={false}
              className="h-full w-full select-none object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {tf("common.noImage", "No image")}
            </div>
          )}

          {/* Top-left badges */}
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
            {discountPercentage > 0 && (
              <span className="inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-semibold text-destructive shadow-sm ring-1 ring-black/5 dark:bg-muted dark:font-bold dark:text-red-400 dark:ring-white/10">
                -{discountPercentage}%
              </span>
            )}
            {product.featured && (
              <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground opacity-0 shadow-sm transition-opacity duration-300 group-hover:opacity-100">
                {tf("common.featured", "Featured")}
              </span>
            )}
          </div>

          {/* Wishlist — appears on hover, like production (visual only). */}
          <span className="pointer-events-none absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-all duration-300 group-hover:opacity-100">
            <Heart className="h-5 w-5" />
          </span>

          {/* Hover actions — Add to Cart / Choose options + Quick view. */}
          <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2 opacity-0 transition-all duration-300 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0">
            <span className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 text-xs font-semibold leading-none text-background shadow-lg">
              <ShoppingBag className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">
                {actionLabel}
              </span>
            </span>
            <span className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/95 px-3 text-xs font-semibold leading-none text-foreground shadow-lg">
              <Maximize2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">
                {tf("product.quickView", "Quick view")}
              </span>
            </span>
          </div>
        </div>

        {/* Product info */}
        <div className="space-y-1.5 px-0.5">
          {colors.length > 0 && (
            <div className="flex items-center gap-1">
              {colors.map((color, index) => {
                const hex = getSwatchColor(color.value, color.colorCode) || "#e5e7eb";
                const isLight =
                  hex === "#ffffff" || hex === "#fffdd0" || hex === "#fef3c7";
                return (
                  <span
                    key={`${color.value}-${index}`}
                    className={cn(
                      "h-4 w-4 rounded-full",
                      isLight ? "border border-border" : "border-0",
                    )}
                    style={{ backgroundColor: hex }}
                    title={color.value}
                  />
                );
              })}
            </div>
          )}

          <h3 className="line-clamp-1 text-sm font-semibold leading-tight text-foreground">
            {product.name?.trim() || "Product title"}
          </h3>

          {selectedColorName && (
            <p className="text-[13px] capitalize leading-snug text-muted-foreground">
              {selectedColorName}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-[6px] border-2 border-emerald-500 px-2.5 py-0.5 text-sm font-semibold leading-snug text-emerald-600 dark:border-emerald-500 dark:text-emerald-400">
                {priceLabel}
              </span>
              {compareAtLabel && discountPercentage > 0 && (
                <span className="text-sm text-muted-foreground line-through">
                  {compareAtLabel}
                </span>
              )}
            </div>

            {showRating && (
              <div className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                <span className="font-medium text-foreground">
                  {(product.rating ?? 0).toFixed(1)}
                </span>
                <span>({product.reviewCount})</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
