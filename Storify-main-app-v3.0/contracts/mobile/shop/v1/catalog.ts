/**
 * Catalogue: categories, product lists and the product page.
 *
 * The server decides, the app displays. Whether a product can be bought, how
 * many, whether a variant has to be chosen first: each arrives as a field. The
 * app never works any of it out from stock numbers or prices.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

export const AVAILABILITY = ["IN_STOCK", "OUT_OF_STOCK", "PRE_ORDER"] as const;
export const Availability = z.enum(AVAILABILITY);
export type Availability = z.infer<typeof Availability>;

export const Rating = z.object({
  average: z.number(),
  count: z.number().int(),
});
export type Rating = z.infer<typeof Rating>;

/** A name with the slug of its page: a vendor, a brand, a category. */
export const NamedLink = z.object({
  name: z.string(),
  slug: z.string(),
});
export type NamedLink = z.infer<typeof NamedLink>;

/**
 * A product as a list shows it. It carries no variants and no stock number: a
 * card shows availability, the product page has the rest.
 */
export const ProductCard = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  /** Left out when the product is sold by quote (`priceOnRequest`). */
  price: Money.optional(),
  /** The price before a discount, to be shown struck through. */
  compareAtPrice: Money.optional(),
  /** Variants differ in price: `price` is the lowest, to be shown as "From". */
  priceVaries: z.boolean(),
  /** Left out when the product has no reviews or the store has them off. */
  rating: Rating.optional(),
  availability: Availability,
  requiresVariantChoice: z.boolean(),
  priceOnRequest: z.boolean(),
  isDigital: z.boolean(),
  /** False for what a store may not sell inside an app (digital goods). */
  purchasableInApp: z.boolean(),
  /**
   * A paid placement. The app must label the card "Sponsored" and report the
   * campaign when the card is seen or opened.
   */
  sponsored: z
    .object({
      campaignId: z.string(),
    })
    .optional(),
  vendor: NamedLink.optional(),
});
export type ProductCard = z.infer<typeof ProductCard>;

export const PRODUCT_SORTS = [
  "RELEVANCE",
  /** Most reviewed and best rated first. */
  "POPULAR",
  "NEWEST",
  "PRICE_ASC",
  "PRICE_DESC",
  "RATING",
] as const;
export const ProductSort = z.enum(PRODUCT_SORTS);
export type ProductSort = z.infer<typeof ProductSort>;

/**
 * GET /products. `category`, `collection`, `brand` and `vendor` are slugs.
 * Without `sort` (and for RELEVANCE without `q`), a search is ordered by
 * relevance and anything else by popularity, as the web's listing is; except
 * a listing of exactly one collection and nothing else, which keeps the order
 * the store gave that collection.
 */
export const ProductListQuery = ListQuery.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  collection: z.string().optional(),
  brand: z.string().optional(),
  vendor: z.string().optional(),
  sort: ProductSort.optional(),
  onSale: z.boolean().optional(),
  /** In the store's currency, as `ProductFacets.priceRange` offers it. */
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  /** Only what can be bought now. */
  inStock: z.boolean().optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

/**
 * On the first page of a plain listing (no search, brand, collection, seller
 * or price filter) the store may place sponsored cards among the results:
 * they arrive marked `sponsored`, in addition to the page's own cards, and may
 * appear again on a later page among the organic results.
 */
export const ProductList = listOf(ProductCard).extend({
  /** How many products the listing holds, across every page. */
  total: z.number().int(),
  /**
   * A misspelt search answered with corrected words: the shopper typed
   * `from`, and the results are for `to` ("Showing results for …").
   */
  searchCorrection: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
});
export type ProductList = z.infer<typeof ProductList>;

/** A price filter's bounds, and the step its slider moves in. */
export const PriceRange = z.object({
  min: Money,
  max: Money,
  step: z.number(),
});
export type PriceRange = z.infer<typeof PriceRange>;

/**
 * GET /products/facets: what a listing can be narrowed by. Scoped to a
 * category's whole branch or to one seller when either is given.
 */
export const ProductFacetsQuery = z.object({
  category: z.string().optional(),
  vendor: z.string().optional(),
});
export type ProductFacetsQuery = z.infer<typeof ProductFacetsQuery>;

export const ProductFacets = z.object({
  categories: z.array(NamedLink),
  collections: z.array(NamedLink),
  brands: z.array(NamedLink),
  /** Left out when every product in scope costs the same. */
  priceRange: PriceRange.optional(),
});
export type ProductFacets = z.infer<typeof ProductFacets>;

export const ProductOptionValue = z.object({
  id: z.string(),
  label: z.string(),
  /** A colour to show as a swatch, as a hex value. */
  swatch: z.string().optional(),
});
export type ProductOptionValue = z.infer<typeof ProductOptionValue>;

export const ProductOption = z.object({
  id: z.string(),
  name: z.string(),
  values: z.array(ProductOptionValue),
});
export type ProductOption = z.infer<typeof ProductOption>;

export const ProductVariant = z.object({
  id: z.string(),
  /** One value id per option, in the order of `options`. */
  optionValueIds: z.array(z.string()),
  price: Money.optional(),
  compareAtPrice: Money.optional(),
  availability: Availability,
  /** The most the shopper may put in the cart. 0 when it cannot be bought. */
  maxQuantity: z.number().int(),
  image: ImageSet.optional(),
});
export type ProductVariant = z.infer<typeof ProductVariant>;

/** GET /products/{slug} */
export const ProductDetail = ProductCard.extend({
  images: z.array(ImageSet),
  /** Written by the merchant in a rich-text editor. */
  descriptionHtml: z.string().optional(),
  attributes: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    }),
  ),
  options: z.array(ProductOption),
  variants: z.array(ProductVariant),
  /** For a product without variants. 0 when it cannot be bought. */
  maxQuantity: z.number().int(),
  brand: NamedLink.optional(),
  category: NamedLink.optional(),
  /** The product's page on the web, for the share sheet. */
  shareUrl: z.string(),
  related: z.array(ProductCard),
  /**
   * "You may also like": paid placements (each card `sponsored`) with
   * regular products between them, in slot order. Empty unless a placement
   * is sold within the rail; when shown, the rail must say it includes paid
   * placements, and each sponsored card carry its label.
   */
  sponsoredRail: z.array(ProductCard),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

/** A category, with the categories inside it (three levels at most). */
export const Category = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  get children() {
    return z.array(Category);
  },
});
export type Category = z.infer<typeof Category>;

/** GET /categories */
export const CategoryTree = z.object({
  items: z.array(Category),
});
export type CategoryTree = z.infer<typeof CategoryTree>;

/** A collection as a list shows it. Its products: `GET /products?collection=`. */
export const CollectionSummary = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  image: ImageSet.optional(),
  productCount: z.number().int(),
});
export type CollectionSummary = z.infer<typeof CollectionSummary>;

/** GET /collections */
export const CollectionList = listOf(CollectionSummary);
export type CollectionList = z.infer<typeof CollectionList>;

/** GET /collections/{slug} */
export const CollectionDetail = CollectionSummary.extend({
  description: z.string().optional(),
});
export type CollectionDetail = z.infer<typeof CollectionDetail>;

/** A brand as a list shows it. Its products: `GET /products?brand=`. */
export const BrandSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logo: ImageSet.optional(),
  productCount: z.number().int(),
});
export type BrandSummary = z.infer<typeof BrandSummary>;

/** GET /brands */
export const BrandList = listOf(BrandSummary);
export type BrandList = z.infer<typeof BrandList>;

/** GET /brands/{slug} */
export const BrandDetail = BrandSummary.extend({
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
});
export type BrandDetail = z.infer<typeof BrandDetail>;

/**
 * A seller of a store with several (`Config.features.multiVendor`); a store
 * with one has none to list, and these endpoints answer 404. Its products:
 * `GET /products?vendor=`.
 */
export const VendorSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logo: ImageSet.optional(),
  banner: ImageSet.optional(),
  /** Checked by the store. */
  verified: z.boolean(),
  /** Across the seller's products; left out until somebody reviewed one. */
  rating: Rating.optional(),
  productCount: z.number().int(),
});
export type VendorSummary = z.infer<typeof VendorSummary>;

/** GET /vendors */
export const VendorList = listOf(VendorSummary);
export type VendorList = z.infer<typeof VendorList>;

/** GET /vendors/{slug} */
export const VendorDetail = VendorSummary.extend({
  description: z.string().optional(),
  /** Where the seller trades from, as precisely as the seller chose to say. */
  location: z.string().optional(),
  unitsSold: z.number().int(),
  /** When the seller joined the store. */
  memberSince: z.string().optional(),
});
export type VendorDetail = z.infer<typeof VendorDetail>;

export const REVIEW_SORTS = ["NEWEST", "OLDEST", "HIGHEST", "LOWEST"] as const;
export const ReviewSort = z.enum(REVIEW_SORTS);
export type ReviewSort = z.infer<typeof ReviewSort>;

/** GET /products/{slug}/reviews */
export const ProductReviewsQuery = ListQuery.extend({
  /** Only reviews with this many stars. */
  rating: z.number().int().min(1).max(5).optional(),
  sort: ReviewSort.optional(),
});
export type ProductReviewsQuery = z.infer<typeof ProductReviewsQuery>;

export const Review = z.object({
  id: z.string(),
  rating: z.number().int(),
  title: z.string().optional(),
  comment: z.string(),
  /** Left out when the account is gone: the app shows its own "Anonymous". */
  author: z.object({
    name: z.string().optional(),
    avatar: ImageSet.optional(),
  }),
  /** Written by somebody who bought the product. */
  verifiedPurchase: z.boolean(),
  createdAt: z.string(),
  images: z.array(ImageSet),
  /** The store's answer. */
  reply: z
    .object({
      comment: z.string(),
      createdAt: z.string().optional(),
    })
    .optional(),
});
export type Review = z.infer<typeof Review>;

/** Every approved review of the product, whatever the `rating` filter. */
export const ReviewSummary = z.object({
  average: z.number(),
  count: z.number().int(),
  /** How many reviews gave each number of stars, 5 first. */
  distribution: z.array(
    z.object({
      stars: z.number().int(),
      count: z.number().int(),
    }),
  ),
});
export type ReviewSummary = z.infer<typeof ReviewSummary>;

export const ProductReviews = listOf(Review).extend({
  summary: ReviewSummary,
});
export type ProductReviews = z.infer<typeof ProductReviews>;
