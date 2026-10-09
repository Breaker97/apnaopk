import mongoose from "mongoose";
import {
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
  PRODUCT_TARGET_SOURCES,
} from "@/lib/site-config/home-page-config";
import type { StorefrontProductCardQuery } from "@/lib/products/storefront-product-cards";
import {
  isProductTargetSource,
  PRODUCT_SOURCE_TARGET_KEYS,
  productSourceTarget,
} from "./product-source";

/**
 * Where one tab of a tabbed product shelf ("Best Selling") takes its products
 * from. Shared by the section, which fetches the first tab with the page, and
 * GET /api/product-cards, which fetches the others — so a tab reads the same
 * either way.
 */
export const PRODUCT_GROUP_SOURCES = [
  "latest",
  "featured",
  "discounted",
  "manual",
  ...PRODUCT_TARGET_SOURCES,
] as const;
export type ProductGroupSource = (typeof PRODUCT_GROUP_SOURCES)[number];

/** Products per tab, clamped to the shared shelf bounds. */
export function productGroupLimit(limit: number | undefined): number {
  return Math.min(
    NEW_ARRIVALS_LIMIT_MAX,
    Math.max(NEW_ARRIVALS_LIMIT_MIN, Math.floor(limit ?? 8) || 8),
  );
}

/**
 * The card query for a tab of the shelf's own sources, or null for a
 * hand-picked tab with no products. A picked category, brand or collection
 * is not a card query of its own — the shared resolver reads it
 * (lib/storefront/section-data/product-source.ts).
 */
export function buildProductGroupQuery(
  source: "latest" | "featured" | "discounted" | "manual",
  productIds: string[],
  limit: number,
): StorefrontProductCardQuery | null {
  if (source === "manual") {
    const ids = productIds
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, NEW_ARRIVALS_LIMIT_MAX);
    if (ids.length === 0) return null;
    return { ids, limit: Math.min(ids.length, limit) };
  }
  const query: StorefrontProductCardQuery = {
    limit,
    sortBy: "createdAt",
    sortOrder: "desc",
  };
  if (source === "discounted") query.onSale = true;
  if (source === "featured") query.featured = true;
  return query;
}

/** A tab's source settings, as its block stores them. */
export interface ProductGroupTabSource {
  source: ProductGroupSource;
  productIds: string[];
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
}

/**
 * The query string GET /api/product-cards takes for a tab: its source, the
 * one setting that source reads — the hand-picked ids, or the picked
 * category, brand or collection — and the size. Nothing else rides along, so
 * a value a tab kept from an earlier source never reaches the request, and
 * two tabs differ in their request whenever they differ in what they show.
 */
export function productGroupSearchParams(
  tab: ProductGroupTabSource,
  limit: number,
  /** A vendor's landing page: the tab reads that store's products alone. */
  vendorId?: string,
): string {
  const params = new URLSearchParams({ source: tab.source, limit: String(limit) });
  if (tab.source === "manual") {
    params.set("ids", tab.productIds.filter(Boolean).join(","));
  } else if (isProductTargetSource(tab.source)) {
    params.set(
      PRODUCT_SOURCE_TARGET_KEYS[tab.source],
      productSourceTarget({ ...tab }),
    );
  }
  if (vendorId) params.set("vendor", vendorId);
  return params.toString();
}
