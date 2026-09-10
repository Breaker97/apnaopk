"use client";

import { useState, useCallback } from "react";
import { ModernProductCard, type ModernProduct } from "./modern-product-card";
import { ProductQuickViewModal } from "./product-quick-view-modal";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";

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
  const [quickViewProduct, setQuickViewProduct] =
    useState<ModernProduct | null>(null);

  const handleQuickView = useCallback((product: ModernProduct) => {
    setQuickViewProduct(product);
  }, []);

  const handleCloseModal = useCallback(() => {
    setQuickViewProduct(null);
  }, []);

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5",
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
            onQuickView={showQuickView ? handleQuickView : undefined}
          />
        ))}
      </div>
      <ProductQuickViewModal
        product={quickViewProduct}
        locale={locale}
        open={!!quickViewProduct}
        onClose={handleCloseModal}
      />
    </>
  );
}
