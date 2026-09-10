/**
 * The product shape the storefront card family renders (`ModernProductCard`,
 * quick view, grids, related products) and that `storefront-product-cards.ts`
 * builds on the server. Defined here, not in the card component, so server
 * code and sibling components never import a type from a component that
 * imports them back.
 */
import type { MoneyRangeLike } from "@/lib/products/price-display";

type ProductOptionValue = {
  _id: string;
  value: string;
  colorCode?: string;
};

type ProductOption = {
  name: string;
  values: ProductOptionValue[];
};

type ProductVariant = {
  _id: string;
  name: string;
  price?: number;
  comparePrice?: number;
  images?: string[];
  options?: Record<string, string>;
  /** Own photo: `mediaId` into the product's media, `image` the legacy field. */
  mediaId?: string;
  image?: string;
  /** The option values this variant is made of (colour among them). */
  optionValues?: { optionName?: string; valueId?: string; value?: string }[];
  stock?: number;
  preorder?: ProductPreorder;
};

export type ProductMediaKind = "image" | "video" | "model" | "external_video";

export type ProductMedia = {
  _id: string;
  type?: ProductMediaKind;
  url: string;
  alt?: string;
  position?: number;
  mimeType?: string;
  thumbnailUrl?: string;
};

export type ProductPreorder = {
  enabled?: boolean;
  releaseDate?: string | Date | null;
  message?: string | null;
  limit?: number | null;
  reservedQuantity?: number | null;
  preorderOnly?: boolean;
  autoConvert?: boolean;
  paymentMode?: "full" | "deposit" | "pay_later";
  depositType?: "percentage" | "fixed";
  depositValue?: number | null;
  batchName?: string | null;
};

export interface ModernProduct {
  _id: string;
  name: string;
  slug: string;
  price: number;
  comparePrice?: number;
  priceRange?: MoneyRangeLike;
  compareAtPriceRange?: MoneyRangeLike;
  /**
   * Sold by quote: the card prints "Price on request" and offers the quote
   * button in place of Add to cart. Read via lib/products/quote-pricing.ts.
   */
  priceOnRequest?: boolean;
  quoteButtonLabel?: string;
  images: string[];
  media?: ProductMedia[];
  rating: number;
  reviewCount: number;
  stock: number;
  /** Stock policy — read via lib/products/stock-policy.ts, never directly. */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: ProductPreorder;
  featured?: boolean;
  status?: string;
  options?: ProductOption[];
  variants?: ProductVariant[];
  createdAt?: string | Date;
  vendorId?: {
    storeName: string;
    slug: string;
    address?: {
      city?: string;
    };
  };
  /**
   * Populated `{name, slug}` on storefront card queries; a bare id string on
   * older payloads, which the card cannot print and ignores. Rendered only
   * when the merchant adds the Category element in the card configurator.
   */
  category?: string | { _id?: string; name?: string; slug?: string };
  /** Units sold, when the surface carries it; powers the "N sold" tag. */
  soldCount?: number;
  /**
   * Kilometres from the shopper to this product's vendor, set by the grid when
   * a location with real coordinates is active. Absent for a city-name match or
   * an un-geocoded vendor, where the card shows the city instead of a number it
   * cannot honestly compute.
   */
  distanceKm?: number;
  /**
   * There is a shop inside the shopper's radius where this can be collected.
   *
   * Set by the query layer from the vendor's own collection points, and kept
   * separate from `distanceKm` on purpose: a vendor who hides their address
   * gets no distance but does still have a counter nearby, and it is never set
   * for a digital product, which cannot be collected at all.
   */
  collectNearby?: boolean;
  /**
   * Paid placement. Set only by the sponsored-pool query layer — organic
   * queries never emit it. Renders the always-visible "Sponsored" pill
   * (FTC/DSA disclosure) and rel="sponsored" on the card links, and carries
   * the campaign id for impression/click tracking.
   */
  sponsored?: boolean;
  sponsoredCampaignId?: string;
  /**
   * True only for an ad SPLICED INTO the grid, not for an organic result that
   * merely happens to be sponsored. The listing count is derived from the
   * organic set, so injected cards must be excludable from it.
   */
  sponsoredInjected?: boolean;
}
