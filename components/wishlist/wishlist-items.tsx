"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlist } from "@/hooks/use-wishlist";
import {
  ModernProductCard,
  ModernProductCardSkeleton,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { ProductQuickViewModal } from "@/components/products/product-quick-view-modal";
import { type Locale } from "@/config/i18n.config";
import {
  CARD_GRID_GAP,
} from "@/components/store/product-grid-columns";

export function WishlistItems() {
  const t = useTranslations();
  const params = useParams();
  const locale = params.locale as Locale;
  const { items, isLoading, fetchWishlist, hydrated } = useWishlist();
  const [quickViewProduct, setQuickViewProduct] = useState<ModernProduct | null>(
    null
  );

  const handleQuickView = useCallback((product: ModernProduct) => {
    setQuickViewProduct(product);
  }, []);

  const handleCloseModal = useCallback(() => {
    setQuickViewProduct(null);
  }, []);

  useEffect(() => {
    fetchWishlist();
  }, [fetchWishlist]);

  // `hydrated` is part of the gate so the persisted list never flashes the
  // empty state: before mount every consumer reads an empty wishlist.
  if (!hydrated || isLoading) {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${CARD_GRID_GAP}`}>
        {[1, 2, 3, 4].map((i) => (
          <ModernProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <Heart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {t("wishlist.empty")}
        </h2>
        <p className="text-muted-foreground mb-6">
          {t("wishlist.emptyDescription")}
        </p>
        <Button asChild>
          <Link href={`/${locale}/products`}>
            {t("common.browseProducts")}
          </Link>
        </Button>
      </div>
    );
  }

  // Transform wishlist items to ModernProduct format. The API returns more
  // product fields than the wishlist store's base type declares.
  type WishlistProduct = (typeof items)[number]["product"] &
    Partial<
      Pick<
        ModernProduct,
        | "comparePrice"
        | "rating"
        | "reviewCount"
        | "featured"
        | "options"
        | "variants"
        | "createdAt"
        | "vendorId"
      >
    >;
  const products: ModernProduct[] = items.map((item) => {
    const product = item.product as WishlistProduct;
    return {
      _id: product._id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      comparePrice: product.comparePrice,
      images: product.images || [],
      rating: product.rating || 0,
      reviewCount: product.reviewCount || 0,
      stock: product.stock || 0,
      featured: product.featured,
      status: product.status,
      options: product.options,
      variants: product.variants,
      createdAt: product.createdAt,
      vendorId: product.vendorId,
    };
  });

  return (
    <>
      <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${CARD_GRID_GAP}`}>
        {products.map((product) => (
          <ModernProductCard
            key={product._id}
            product={product}
            locale={locale}
            showQuickView={true}
            onQuickView={handleQuickView}
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
