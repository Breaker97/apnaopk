import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { RelatedProductsCarouselLazy as RelatedProductsCarousel } from "./related-products-carousel-lazy";
import { getProductPageSponsoredLane } from "@/lib/boosts/sponsored-placement";

/**
 * Product-page rail — a MIXED shelf, like the home rail: position N at slot N,
 * unsold rungs filled with regular products, and nothing promoted upward.
 *
 * Two things changed with the ladder. The rail is no longer category-scoped —
 * the ladder is global, so the old "prefer this category, refill from the
 * global pool" merge has nothing to prefer. And the heading is no longer
 * "Sponsored": over a rail whose slots are mostly organic that would
 * misdescribe them as ads. The per-card pill remains the disclosure.
 */
export async function SponsoredProductsCarousel({
  productId,
  categoryId,
  locale,
}: {
  productId: string;
  categoryId?: string;
  locale: Locale;
}) {
  // Null when nothing paid sits within this rail's own depth: render nothing
  // rather than print a paid-placement note over an all-organic row.
  const lane = await getProductPageSponsoredLane({ productId, categoryId });
  if (!lane) return null;

  const t = await getTranslations({ locale });
  return (
    <RelatedProductsCarousel
      products={lane}
      locale={locale}
      title={
        t.has("product.youMayAlsoLike")
          ? t("product.youMayAlsoLike")
          : "You may also like"
      }
      subtitle={
        t.has("common.includesSponsored")
          ? t("common.includesSponsored")
          : "Includes paid placements"
      }
    />
  );
}
