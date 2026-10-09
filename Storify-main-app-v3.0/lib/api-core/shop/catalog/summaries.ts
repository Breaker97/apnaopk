import type {
  BrandSummary,
  Category,
  CollectionSummary,
  VendorSummary,
} from "@/contracts/mobile/shop/v1/catalog";
import type { StorefrontCategory } from "@/lib/storefront/storefront-categories";
import type { StorefrontVendorDirectoryEntry } from "@/lib/storefront/storefront-vendors";
import { imageSet } from "../images";

/**
 * Categories, collections, brands and sellers as the contract shows them,
 * from what the storefront's readers return.
 */

export function toCategory(category: StorefrontCategory): Category {
  const image = imageSet(category.image);
  return {
    id: category._id,
    slug: category.slug,
    name: category.name,
    ...(image ? { image } : {}),
    children: (category.children ?? []).map(toCategory),
  };
}

type CollectionSource = {
  _id: unknown;
  slug: string;
  title: string;
  image?: string | { url?: string; alt?: string } | null;
  productCount?: number;
};

/** A collection's picture: `{ url, alt }`, or a bare URL on older documents. */
function collectionImage(image: CollectionSource["image"]) {
  if (typeof image === "string") return imageSet(image);
  return imageSet(image?.url, image?.alt);
}

export function toCollectionSummary(collection: CollectionSource): CollectionSummary {
  const image = collectionImage(collection.image);
  return {
    id: String(collection._id),
    slug: collection.slug,
    title: collection.title,
    ...(image ? { image } : {}),
    productCount: Number(collection.productCount) || 0,
  };
}

type BrandSource = {
  _id: unknown;
  slug: string;
  name: string;
  logo?: string;
  productCount?: number;
};

export function toBrandSummary(brand: BrandSource): BrandSummary {
  const logo = imageSet(brand.logo);
  return {
    id: String(brand._id),
    slug: brand.slug,
    name: brand.name,
    ...(logo ? { logo } : {}),
    productCount: Number(brand.productCount) || 0,
  };
}

export function toVendorSummary(
  vendor: Pick<
    StorefrontVendorDirectoryEntry,
    "id" | "slug" | "storeName" | "logo" | "banner" | "verified" | "rating" | "reviewCount" | "productCount"
  >,
): VendorSummary {
  const logo = imageSet(vendor.logo);
  const banner = imageSet(vendor.banner);
  return {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.storeName,
    ...(logo ? { logo } : {}),
    ...(banner ? { banner } : {}),
    verified: vendor.verified,
    ...(vendor.reviewCount > 0
      ? { rating: { average: vendor.rating, count: vendor.reviewCount } }
      : {}),
    productCount: vendor.productCount,
  };
}
