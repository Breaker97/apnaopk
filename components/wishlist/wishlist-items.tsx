"use client";

import { use, useEffect } from "react";
import Link from "@/components/language/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlist, wishlistFirstSync } from "@/hooks/use-wishlist";
import { DEFAULT_STALE_TIME_MS } from "@/hooks/use-suspense-resource";
import {
  ModernProductCard,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { type Locale } from "@/config/i18n.config";
import {
  CARD_GRID_GAP,
} from "@/components/store/product-grid-columns";

/**
 * The first visit in a tab suspends — the page's `<ClientSuspense>` shows the
 * card skeletons — until the server's list is known. After that the store
 * holds it (adds and removes keep it current), so coming back shows it at once
 * with no request, and a list older than a minute is refreshed behind it.
 */
export function WishlistItems() {
  const t = useTranslations();
  const params = useParams();
  const locale = params.locale as Locale;
  const { items, isSynced, syncedAt, fetchWishlist } = useWishlist();
  // The first sync suspends: the page's `<ClientSuspense>` shows the skeleton
  // until it lands, so the persisted list never flashes the empty state.
  if (!isSynced) use(wishlistFirstSync());

  useEffect(() => {
    if (isSynced && Date.now() - syncedAt > DEFAULT_STALE_TIME_MS) {
      void fetchWishlist();
    }
  }, [isSynced, syncedAt, fetchWishlist]);

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
          <Link href="/products">
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
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${CARD_GRID_GAP}`}>
      {products.map((product) => (
        <ModernProductCard
          key={product._id}
          product={product}
          locale={locale}
          showQuickView={true}
        />
      ))}
    </div>
  );
}
