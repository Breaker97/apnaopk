import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { HomeNewArrivalsCarouselLazy as HomeNewArrivalsCarousel } from "@/components/store/home-new-arrivals-carousel-lazy";
import { getHomeSponsoredRail } from "@/lib/boosts/sponsored-placement";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";

/**
 * Home rail — a MIXED shelf under strict-index rendering: the product holding
 * position N sits at slot N, and an unsold rung shows a regular product rather
 * than collapsing the row.
 *
 * The heading is fixed to the localized "Sponsored" — the word the large
 * marketplaces put over paid shelves — and is deliberately not editable, so
 * the row can never be retitled into something that hides what it is. The
 * per-card pill on every paid rung is the legal disclosure; organic fillers
 * carry no pill, which is what tells them apart.
 */
export async function HomeSponsoredProducts({
  locale,
  limit = 8,
  desktopColumns = 4,
  themedHeading = false,
  ctx,
}: {
  locale: Locale;
  limit?: number;
  /** Cards per visible desktop row; the carousel clamps it to its 2–6 tiers. */
  desktopColumns?: number;
  themedHeading?: boolean;
  /**
   * The section render context, for its `preview` flag. The live rules
   * below hide the rail whenever it would misdescribe itself; in the
   * builder's preview that silence reads as a broken section, so preview
   * shows the shelf with regular products and says so.
   */
  ctx?: Pick<SectionRenderContext, "preview">;
}) {
  const preview = Boolean(ctx?.preview);
  const rail = await getHomeSponsoredRail({ limit });
  if (!rail.live && !preview) return null;

  const t = await getTranslations({ locale });
  const tf = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  if (!rail.live) {
    return sectionEmptyState(
      { preview },
      {
        title: tf("home.sponsoredPreview.offTitle", "Sponsored products"),
        hint: tf(
          "home.sponsoredPreview.offHint",
          "Boosting is switched off, or the home placement is. Turn it on under Boosting to fill this shelf with booked placements and regular products.",
        ),
      },
    );
  }

  const { lane, sold } = rail;
  if (!sold && !preview) return null;

  // Preview with nothing booked: the shelf renders with regular products so
  // the merchant can judge the layout, and the subtitle says exactly that
  // rather than claiming paid placements it does not hold. Live, the
  // "Sponsored" heading is the whole disclosure and carries no subtitle.
  const subtitle = sold
    ? undefined
    : tf(
        "home.sponsoredPreview.fill",
        "Preview only: regular products fill the shelf until a boost is booked.",
      );

  return (
    <HomeNewArrivalsCarousel
      locale={locale}
      products={lane}
      title={tf("common.sponsored", "Sponsored")}
      subtitle={subtitle}
      desktopColumns={desktopColumns}
      themedHeading={themedHeading}
    />
  );
}
