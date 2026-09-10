import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { RelatedProductsCarousel } from "./related-products-carousel";
import {
  buildSponsoredLane,
  getSponsoredLadderPool,
  getSponsoredPlacementDepths,
  getStorefrontBoostingSettings,
  laneHasSponsored,
  resolveLadderAt,
} from "@/lib/boosts/sponsored-products";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";

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
  const boosting = await getStorefrontBoostingSettings();
  if (!boosting.enabled || !boosting.placements.productPage) return null;

  const [pool, depths] = await Promise.all([
    getSponsoredLadderPool({ hideOutOfStock: boosting.hideOutOfStock }),
    getSponsoredPlacementDepths(),
  ]);

  // The viewed product is dropped AFTER the cached fetch — putting it in the
  // query would key one cache entry per product page.
  const ladder = resolveLadderAt(pool, { excludeProductId: productId });
  const depth = depths.productPage;

  const fillers = await getStorefrontProductCards({
    limit: depth * 2,
    excludeIds: [productId],
    ...(categoryId ? { categoryIds: [categoryId] } : {}),
    hideOutOfStock: boosting.hideOutOfStock,
  });

  const lane = buildSponsoredLane(ladder, fillers, depth);
  // Nothing paid within this rail's own depth: render nothing rather than print
  // a paid-placement note over an all-organic row.
  if (!laneHasSponsored(lane)) return null;

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
