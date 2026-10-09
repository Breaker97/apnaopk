import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { HomeTopVendorsCarouselLazy as HomeTopVendorsCarousel } from "@/components/store/home-top-vendors-carousel-lazy";
import type { TopVendorsLabels } from "@/components/store/home-top-vendors-carousel";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { fetchTopVendors } from "@/lib/storefront/section-data/top-vendors";
import type {
  TopVendorSource,
  TopVendorsDisplay,
} from "@/lib/storefront/sections/top-vendors";

/** Which stores the section shows: the part of its settings the read uses. */
interface TopVendorsQuery {
  source: TopVendorSource;
  /** Hand-picked Vendor ids in display order; read when source is "manual". */
  vendorIds: string[];
  limit: number;
  /** Leave out stores with no active products. */
  hideEmptyStores: boolean;
}

interface HomeTopVendorsProps {
  locale: Locale;
  title: string;
  subtitle: string;
  /** Empty means the translated "Go to Shop". */
  ctaLabel: string;
  /** Empty hides the link. */
  viewAllLabel: string;
  viewAllLink: string;
  query: TopVendorsQuery;
  display: TopVendorsDisplay;
  preview?: boolean;
}

async function getLabels(locale: Locale): Promise<TopVendorsLabels> {
  const tHome = await getTranslations({ locale, namespace: "home" });
  const safe = (
    key:
      | "topVendorsRating"
      | "topVendorsSold"
      | "topVendorsPrice"
      | "topVendorsGoToShop"
      | "scrollLeft"
      | "scrollRight",
    fallback: string,
  ) => {
    try {
      return tHome(key);
    } catch {
      return fallback;
    }
  };

  return {
    rating: safe("topVendorsRating", "rating"),
    sold: safe("topVendorsSold", "sold"),
    price: safe("topVendorsPrice", "Price"),
    goToShop: safe("topVendorsGoToShop", "Go to Shop"),
    scrollLeft: safe("scrollLeft", "Scroll left"),
    scrollRight: safe("scrollRight", "Scroll right"),
  };
}

export async function HomeTopVendors({
  locale,
  title,
  subtitle,
  ctaLabel,
  viewAllLabel,
  viewAllLink,
  query,
  display,
  preview,
}: HomeTopVendorsProps) {
  const [vendors, labels] = await Promise.all([
    fetchTopVendors(
      query.limit,
      query.source,
      query.vendorIds.join(","),
      query.hideEmptyStores,
    ),
    getLabels(locale),
  ]);

  if (vendors.length === 0) {
    return sectionEmptyState(
      { preview },
      {
        title: title || "Top Vendors",
        hint:
          query.source === "manual"
            ? "Pick approved stores for this section."
            : "No approved stores to show yet. Approved marketplace stores appear here automatically.",
      },
    );
  }

  return (
    <HomeTopVendorsCarousel
      locale={locale}
      title={title}
      subtitle={subtitle}
      viewAll={
        viewAllLabel && viewAllLink
          ? { label: viewAllLabel, href: viewAllLink }
          : undefined
      }
      vendors={vendors}
      labels={ctaLabel ? { ...labels, goToShop: ctaLabel } : labels}
      display={display}
    />
  );
}
