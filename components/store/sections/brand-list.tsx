import { unstable_cache } from "next/cache";
import {
  BrandListView,
  type BrandListAppearance,
  type BrandListWidth,
  type BrandTile,
} from "@/components/store/sections/brand-list-view";
import { type Locale } from "@/config/i18n.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { connectDB } from "@/lib/db";
import { Brand } from "@/models";

const fetchBrands = unstable_cache(
  async (featuredOnly: boolean, limit: number) => {
    try {
      await connectDB();
      const query: Record<string, unknown> = { isActive: true };
      if (featuredOnly) query.featured = true;
      const brands = await Brand.find(query)
        .select("name slug logo")
        .sort({ featured: -1, name: 1 })
        .limit(limit)
        .lean();
      return JSON.parse(JSON.stringify(brands)) as {
        _id: string;
        name: string;
        slug: string;
        logo?: string;
      }[];
    } catch {
      return [];
    }
  },
  ["section-brand-list"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands],
  },
);

/** Curated picks resolved by id, public-storefront brands only. */
const fetchBrandsByIds = unstable_cache(
  async (ids: string[]) => {
    try {
      await connectDB();
      const brands = await Brand.find({
        _id: { $in: ids },
        ...STOREFRONT_BRAND_FILTER,
      })
        .select("name slug logo")
        .lean();
      return JSON.parse(JSON.stringify(brands)) as {
        _id: string;
        name: string;
        slug: string;
        logo?: string;
      }[];
    } catch {
      return [];
    }
  },
  ["section-brand-list-picks"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands],
  },
);

interface BrandListProps {
  locale: Locale;
  /** Picked Brand ids in row order; empty falls back to the Brands DB. */
  brandIds: string[];
  appearance?: BrandListAppearance;
  /** Container framing — the section's Width setting. */
  width?: BrandListWidth;
  /** Shown instead of nothing when there are no brands at all (preview only). */
  emptyState?: React.ReactNode;
}

async function resolveTiles(
  locale: Locale,
  brandIds: string[],
): Promise<BrandTile[]> {
  if (brandIds.length > 0) {
    const brands = await fetchBrandsByIds(Array.from(new Set(brandIds)));
    const byId = new Map(brands.map((brand) => [brand._id, brand]));
    // Row order is the merchant's order; a brand that fell off the public
    // storefront (deactivated, archived) simply drops out of the strip.
    return brandIds
      .map((id) => byId.get(id))
      .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand))
      .map((brand) => ({
        key: brand._id,
        image: brand.logo ?? "",
        name: brand.name,
        href: `/${locale}/brands/${brand.slug}`,
      }));
  }

  // Auto mode: sections without picks keep showing the store's Brands,
  // featured first — falling back to all active brands so the strip isn't
  // empty before anyone has starred one.
  let brands = await fetchBrands(true, 10);
  if (brands.length === 0) brands = await fetchBrands(false, 10);
  return brands.map((brand) => ({
    key: brand._id,
    image: brand.logo ?? "",
    name: brand.name,
    href: `/${locale}/products?brand=${encodeURIComponent(brand.slug)}`,
  }));
}

/** The brand logo strip; each logo links through to its brand page. */
export async function BrandList({
  locale,
  brandIds,
  appearance = "cards",
  width = "fixed",
  emptyState = null,
}: BrandListProps) {
  const tiles = await resolveTiles(locale, brandIds);
  if (tiles.length === 0) return <>{emptyState}</>;

  return <BrandListView tiles={tiles} appearance={appearance} width={width} />;
}
