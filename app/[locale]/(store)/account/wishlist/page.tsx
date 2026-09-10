import { setRequestLocale, getTranslations } from "next-intl/server";
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

      {/* Wishlist Items */}
      <WishlistItems />
    </div>
  );
}
