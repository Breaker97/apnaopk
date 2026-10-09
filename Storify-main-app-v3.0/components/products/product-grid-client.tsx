"use client";

import { ModernProductCard, type ModernProduct } from "./modern-product-card";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import {
  CARD_GRID_GAP,
} from "@/components/store/product-grid-columns";

/** Cards on the first grid row are above the fold and eager-load their shot. */
const FIRST_ROW_CARDS = 4;

interface ProductGridClientProps {
  products: ModernProduct[];
  locale: Locale;
  showQuickView?: boolean;
  /** Extra grid classes, e.g. a themed column-count override. */
  className?: string;
}

export function ProductGridClient({
  products,
  locale,
  showQuickView = true,
  className,
}: ProductGridClientProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
        CARD_GRID_GAP,
        className,
      )}
    >
      {products.map((product: ModernProduct, index) => (
        <ModernProductCard
          key={product._id}
          product={product}
          locale={locale}
          imagePriority={index < FIRST_ROW_CARDS}
          showQuickView={showQuickView}
        />
      ))}
    </div>
  );
}
