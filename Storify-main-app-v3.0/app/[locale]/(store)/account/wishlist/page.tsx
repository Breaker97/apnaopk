import { setRequestLocale, getTranslations } from "next-intl/server";
import { ClientSuspense } from "@/components/common/client-suspense";
import { ModernProductCardSkeleton } from "@/components/products/modern-product-card";
import { CARD_GRID_GAP } from "@/components/store/product-grid-columns";
import { WishlistItems } from "@/components/wishlist/wishlist-items";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function WishlistPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="space-y-6">
      {/* Page Header — desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">{t("wishlist.title")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("account.wishlistDesc")}
        </p>
      </div>

      {/* Wishlist Items — its loading state is this boundary's fallback. */}
      <ClientSuspense
        fallback={
          <div
            className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${CARD_GRID_GAP}`}
            aria-busy="true"
          >
            {[1, 2, 3, 4].map((i) => (
              <ModernProductCardSkeleton key={i} />
            ))}
          </div>
        }
      >
        <WishlistItems />
      </ClientSuspense>
    </div>
  );
}
