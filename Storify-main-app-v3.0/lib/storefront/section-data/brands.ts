import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { connectDB } from "@/lib/db";
import { withFallback } from "@/lib/storefront/cached-read";
import { Brand } from "@/models";
import type { SectionReadMode } from "./read-mode";

interface BrandRow {
  _id: string;
  name: string;
  slug: string;
  logo?: string;
}

const readBrands = unstable_cache(
  async (featuredOnly: boolean, limit: number) => {
    await connectDB();
    const query: Record<string, unknown> = { isActive: true };
    if (featuredOnly) query.featured = true;
    const brands = await Brand.find(query)
      .select("name slug logo")
      .sort({ featured: -1, name: 1 })
      .limit(limit)
      .lean();
    return JSON.parse(JSON.stringify(brands)) as BrandRow[];
  },
  ["section-brand-list"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands],
  },
);

/** Curated picks resolved by id, public-storefront brands only. */
const readBrandsByIds = unstable_cache(
  async (ids: string[]) => {
    await connectDB();
    const brands = await Brand.find({
      _id: { $in: ids },
      ...STOREFRONT_BRAND_FILTER,
    })
      .select("name slug logo")
      .lean();
    return JSON.parse(JSON.stringify(brands)) as BrandRow[];
  },
  ["section-brand-list-picks"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands],
  },
);

const fetchBrands = withFallback(readBrands, () => []);
const fetchBrandsByIds = withFallback(readBrandsByIds, () => []);

/** One logo in the brand strip, and where it leads (a path without the locale). */
interface BrandListTile {
  id: string;
  name: string;
  slug: string;
  logo: string;
  href: string;
}

/**
 * The Brand List's logos. Picked brands in the merchant's row order — a
 * brand that fell off the public storefront (deactivated, archived) simply
 * drops out — each linking to its brand page. Without picks, the store's
 * brands, featured first, falling back to every active brand so the strip
 * isn't empty before anyone has starred one; those link to the catalogue
 * filtered by the brand.
 */
export async function loadBrandList(
  brandIds: string[],
  mode: SectionReadMode = "page",
): Promise<BrandListTile[]> {
  if (brandIds.length > 0) {
    const read = mode === "strict" ? readBrandsByIds : fetchBrandsByIds;
    const brands = await read(Array.from(new Set(brandIds)));
    const byId = new Map(brands.map((brand) => [brand._id, brand]));
    return brandIds
      .map((id) => byId.get(id))
      .filter((brand): brand is BrandRow => Boolean(brand))
      .map((brand) => ({
        id: brand._id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logo ?? "",
        href: `/brands/${brand.slug}`,
      }));
  }

  const read = mode === "strict" ? readBrands : fetchBrands;
  let brands = await read(true, 10);
  if (brands.length === 0) brands = await read(false, 10);
  return brands.map((brand) => ({
    id: brand._id,
    name: brand.name,
    slug: brand.slug,
    logo: brand.logo ?? "",
    href: `/products?brand=${encodeURIComponent(brand.slug)}`,
  }));
}
