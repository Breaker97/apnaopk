import mongoose from "mongoose";
import {
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";
import type { StorefrontProductCardQuery } from "@/lib/products/storefront-product-cards";

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
] as const;
export type ProductGroupSource = (typeof PRODUCT_GROUP_SOURCES)[number];

/** Products per tab, clamped to the shared shelf bounds. */
export function productGroupLimit(limit: number | undefined): number {
  return Math.min(
    NEW_ARRIVALS_LIMIT_MAX,
    Math.max(NEW_ARRIVALS_LIMIT_MIN, Math.floor(limit ?? 8) || 8),
  );
}

/** The card query for a tab, or null for a hand-picked tab with no products. */
export function buildProductGroupQuery(
  source: ProductGroupSource,
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

/** The query string GET /api/product-cards takes for a tab. */
export function productGroupSearchParams(
  source: ProductGroupSource,
  productIds: string[],
  limit: number,
): string {
  const params = new URLSearchParams({ source, limit: String(limit) });
  if (source === "manual") params.set("ids", productIds.filter(Boolean).join(","));
  return params.toString();
}
