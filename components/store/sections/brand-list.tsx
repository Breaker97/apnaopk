import {
  BrandListView,
  type BrandListAppearance,
  type BrandListWidth,
  type BrandTile,
} from "@/components/store/sections/brand-list-view";
import { loadBrandList } from "@/lib/storefront/section-data/brands";
import { vendorProductsPath } from "@/lib/storefront/section-data/product-source";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

interface BrandListProps {
  /** Picked Brand ids in row order; empty falls back to the Brands DB. */
  brandIds: string[];
  appearance?: BrandListAppearance;
  /** Container framing — the section's Width setting. */
  width?: BrandListWidth;
  /** Shown instead of nothing when there are no brands at all (preview only). */
  emptyState?: React.ReactNode;
  /**
   * A vendor's landing page: only the brands that store sells (picked ones
   * in row order, else its busiest ten), each opening the store's own
   * Products tab filtered to the brand.
   */
  vendor?: { id: string; slug: string };
}

/** Auto mode's cap — the same ten the store-wide strip shows. */
const AUTO_BRAND_LIMIT = 10;

async function vendorTiles(
  brandIds: string[],
  vendor: { id: string; slug: string },
): Promise<BrandTile[]> {
  const brands =
    (await getVendorStoreTaxonomy(vendor.id).catch(() => null))?.brands ?? [];
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  // A pick the store no longer sells drops out, like a deactivated brand.
  const rows =
    brandIds.length > 0
      ? Array.from(new Set(brandIds))
          .map((id) => byId.get(id))
          .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand))
      : brands.slice(0, AUTO_BRAND_LIMIT);
  return rows.map((brand) => ({
    key: brand.id,
    image: brand.logo ?? "",
    name: brand.name,
    href: vendorProductsPath(vendor.slug, { key: "brand", slug: brand.slug }),
  }));
}

/** The brand logo strip; each logo links through to its brand page. */
export async function BrandList({
  brandIds,
  appearance = "cards",
  width = "fixed",
  emptyState = null,
  vendor,
}: BrandListProps) {
  const tiles: BrandTile[] = vendor
    ? await vendorTiles(brandIds, vendor)
    : (await loadBrandList(brandIds)).map((brand) => ({
        key: brand.id,
        image: brand.logo,
        name: brand.name,
        href: brand.href,
      }));
  if (tiles.length === 0) return <>{emptyState}</>;

  return <BrandListView tiles={tiles} appearance={appearance} width={width} />;
}
