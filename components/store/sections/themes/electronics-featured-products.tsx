"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { type ModernProduct } from "@/components/products/modern-product-card";
import { type Locale } from "@/config/i18n.config";
import { formatProductPrice } from "@/lib/products/price-display";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";

/**
 * The sidebar's featured mini-cards: a small muted tile, the name, the price
 * and a star row — the design's compact strip under the filter groups.
 * Client-side only for the currency hook the price runs through.
 */
export function ElectronicsFeaturedProducts({
  locale,
  products,
}: {
  locale: Locale;
  products: ModernProduct[];
}) {
  const { formatPrice } = useCurrency();

  return (
    <div className="flex flex-col gap-4">
      {products.map((product) => {
        const stars = Math.round(
          Math.min(5, Math.max(0, product.rating ?? 0)),
        );
        return (
          <Link
            key={product._id}
            href={`/${locale}/products/${product.slug}`}
            className="group flex items-center gap-4"
          >
            <span className="grid size-[98px] shrink-0 place-items-center overflow-hidden rounded-lg bg-muted transition-colors group-hover:bg-muted/70">
              {product.images?.[0] ? (
                <AppImage
                  src={product.images[0]}
                  alt=""
                  width={98}
                  height={98}
                  aria-hidden
                  sizes="98px"
                  className="h-[76%] w-[76%] object-contain transition-transform duration-300 group-hover:scale-[1.05]"
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="line-clamp-1 text-[13px] font-semibold tracking-[-0.02em] text-foreground transition-colors group-hover:text-primary">
                {product.name}
              </span>
              <span className="text-[12px] font-bold text-foreground/90">
                {formatProductPrice(product, formatPrice)}
              </span>
              <span className="flex items-center" aria-hidden>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star
                    key={index}
                    className={cn(
                      "size-[11px]",
                      index < stars
                        ? "fill-amber-400 text-amber-400"
                        : "fill-muted text-muted",
                    )}
                  />
                ))}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
