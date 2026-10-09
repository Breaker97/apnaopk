/**
 * Products and their stock: find one (by search or by scanning its barcode),
 * change its price and status, and count units in or out.
 *
 * Scope follows the website's dashboards: a seller and their staff see the
 * seller's products; the store's staff see the products of the sellers in
 * their scope; an administrator sees every product. A product out of reach
 * answers 404.
 *
 * Prices are sent as numbers in the currency's main unit (12.5 is 12.50) and
 * answered as `Money`. The store's own rules apply on save exactly as on the
 * website: the product feature switches, "price on request", stock policy.
 *
 * Session B4.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

/** The store's product statuses: on sale, not yet, or reachable by link only. */
export const PRODUCT_STATUSES = ["active", "draft", "unlisted"] as const;
export const ProductStatus = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof ProductStatus>;

/**
 * GET /products. Newest first, as the dashboards list them.
 *
 * `barcode` is what the scanner read (EAN-13, UPC-A, Code 128), as it read it:
 * the server cleans it up the way the point of sale does (control characters,
 * spaces and dashes dropped, letters upper-cased, a UPC-A read as a 13-digit
 * EAN with a leading 0 taken as the 12-digit code) and answers every product
 * carrying it as a barcode or a SKU, on the product or one of its variants
 * (normally one), all on one page. With `barcode`, `search` is ignored.
 *
 * `categoryId`, `brandId` and `collectionId` take an id GET
 * /products/filters lists. A category takes in the categories under it; a
 * collection is the products it holds, hand-picked or by its rules. An id the
 * store does not have finds nothing.
 */
export const ProductListQuery = ListQuery.extend({
  /** The product's name or SKU. */
  search: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  status: ProductStatus.optional(),
  /** Only products at or below the low-stock threshold (the home tile's list). */
  lowStock: z.boolean().optional(),
  /** Products in this category, or in one under it. */
  categoryId: z.string().trim().min(1).max(64).optional(),
  brandId: z.string().trim().min(1).max(64).optional(),
  collectionId: z.string().trim().min(1).max(64).optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

/** A product as the list shows it. */
export const ProductListItem = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().optional(),
  status: z.string(),
  image: ImageSet.optional(),
  /** The price, or the lowest variant price. Left out for "price on request". */
  price: Money.optional(),
  /** Above `price` when its variants differ. */
  maxPrice: Money.optional(),
  /** Units available to sell, all locations and variants together. */
  stock: z.number().int(),
  /** At or below the low-stock threshold. */
  lowStock: z.boolean(),
  /** Stock is not counted for it (a digital product, or tracking off). */
  untracked: z.boolean(),
  variantCount: z.number().int(),
  /** The seller, on a store with sellers, for the store's own operators. */
  vendorName: z.string().optional(),
});
export type ProductListItem = z.infer<typeof ProductListItem>;

export const ProductList = listOf(ProductListItem);
export type ProductList = z.infer<typeof ProductList>;

/** A category the list can be narrowed to; `parentId` names the one it sits under. */
export const ProductFilterCategory = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
});
export type ProductFilterCategory = z.infer<typeof ProductFilterCategory>;

export const ProductFilterOption = z.object({
  id: z.string(),
  name: z.string(),
});
export type ProductFilterOption = z.infer<typeof ProductFilterOption>;

/**
 * GET /products/filters: what GET /products can be narrowed by, read from the
 * operator's own products, each list in the store's order. `categories` is a
 * tree: the categories products sit in and every category above them; one
 * with no `parentId` is at the top. A collection is listed when it holds at
 * least one of the operator's products.
 */
export const ProductFilterOptions = z.object({
  categories: z.array(ProductFilterCategory),
  brands: z.array(ProductFilterOption),
  collections: z.array(ProductFilterOption),
});
export type ProductFilterOptions = z.infer<typeof ProductFilterOptions>;

/** Where a row's units are, at one location. */
export const StockLocation = z.object({
  locationId: z.string(),
  name: z.string(),
  /** Units available to sell there. */
  available: z.number().int(),
});
export type StockLocation = z.infer<typeof StockLocation>;

export const ProductVariant = z.object({
  id: z.string(),
  /** Its options, as the store names them ("Red / XL"). */
  name: z.string(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  price: Money.optional(),
  compareAtPrice: Money.optional(),
  stock: z.number().int(),
  image: ImageSet.optional(),
  /** Its available units per location, the locations this operator may see. */
  locations: z.array(StockLocation),
});
export type ProductVariant = z.infer<typeof ProductVariant>;

/** GET /products/{id}, and the answer to PATCH /products/{id}. */
export const ProductDetail = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  status: z.string(),
  images: z.array(ImageSet),
  /** Left out on a product whose prices are on its variants, and for "price on request". */
  price: Money.optional(),
  compareAtPrice: Money.optional(),
  /** "Price on request": the product shows no price to shoppers. */
  priceOnRequest: z.boolean(),
  variants: z.array(ProductVariant),
  stock: z.number().int(),
  lowStock: z.boolean(),
  untracked: z.boolean(),
  /**
   * Its available units per location (its variants' together), the locations
   * this operator may see. GET /products/{id}/stock has the full figures.
   */
  locations: z.array(StockLocation),
  vendorName: z.string().optional(),
  /**
   * The version this answer is: send it back as `If-Match` with a change. The
   * answer's `ETag` is the same value, quoted; either form is accepted.
   *
   * Opaque. It moves with every write to the product, a sale or a stock
   * adjustment included, so a 412 does not always mean somebody changed what
   * you are changing: read the product again, and when the fields being
   * edited still hold what the change started from, send it again with the
   * new version without asking.
   */
  version: z.string(),
  updatedAt: z.string(),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

/**
 * PATCH /products/{id}: change the price, compare-at price or status. Send
 * `If-Match` with the `version` the change was made against: without it the
 * answer is 428 PRECONDITION_REQUIRED, and when somebody changed the product
 * since, 412 PRECONDITION_FAILED (read it again and show what changed).
 *
 * Only the fields sent change; `null` clears a compare-at price. A product
 * with variants takes its prices per variant, in `variants`.
 */
export const ProductUpdateRequest = z.object({
  price: z.number().min(0).optional(),
  compareAtPrice: z.number().min(0).nullable().optional(),
  status: ProductStatus.optional(),
  variants: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        price: z.number().min(0).optional(),
        compareAtPrice: z.number().min(0).nullable().optional(),
      }),
    )
    .max(250)
    .optional(),
});
export type ProductUpdateRequest = z.infer<typeof ProductUpdateRequest>;

/**
 * One row of a product's stock: the product itself, or one variant.
 *
 * - `available`: what can still be sold.
 * - `committed`: sold, not shipped yet.
 * - `unavailable`: here but not for sale (damaged returns not yet restocked).
 * - `onHand`: the three together, what a count of the shelves would find.
 */
export const StockRow = z.object({
  /** Left out for the product's own row. */
  variantId: z.string().optional(),
  name: z.string(),
  sku: z.string().optional(),
  available: z.number().int(),
  committed: z.number().int(),
  unavailable: z.number().int(),
  onHand: z.number().int(),
  /** The locations this operator may see; available units only. */
  locations: z.array(StockLocation),
});
export type StockRow = z.infer<typeof StockRow>;

/** GET /products/{id}/stock, and the answer to a stock adjustment. */
export const ProductStock = z.object({
  productId: z.string(),
  untracked: z.boolean(),
  lowStockThreshold: z.number().int(),
  rows: z.array(StockRow),
});
export type ProductStock = z.infer<typeof ProductStock>;

/** Why units are added or removed; kept with the change for the stock history. */
export const STOCK_ADJUSTMENT_REASONS = [
  "received",
  "damaged",
  "count",
  "correction",
  "other",
] as const;

/**
 * POST /products/{id}/stock-adjustments: add units (`delta` above 0) or take
 * them away (below 0) at one location. Send `Idempotency-Key`: a retry of the
 * same tap never counts twice. Stock never goes below zero.
 */
export const StockAdjustmentRequest = z.object({
  locationId: z.string().min(1).max(64),
  /** Required on a product with variants. */
  variantId: z.string().min(1).max(64).optional(),
  delta: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, { message: "Add or remove at least one unit." }),
  reason: z.enum(STOCK_ADJUSTMENT_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type StockAdjustmentRequest = z.infer<typeof StockAdjustmentRequest>;

/**
 * What moved a product's stock, in the store's words:
 * - `adjustment`: units counted in or out by hand, in the app (with a
 *   `reason`) or on the website's inventory screens;
 * - `transfer_shipped`: units leaving a location on a transfer;
 * - `transfer_received`: units of a transfer arriving at its destination
 *   (units written off on arrival are not stock, and not listed);
 * - `transfer_cancelled`: units of a transfer cancelled on its way, back at
 *   the location they left;
 * - `return_restocked`: units a customer sent back, put back on sale.
 *
 * More kinds may come within v1: show one you do not know as a plain
 * movement, with its change.
 */
export const STOCK_MOVEMENT_KINDS = [
  "adjustment",
  "transfer_shipped",
  "transfer_received",
  "transfer_cancelled",
  "return_restocked",
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/**
 * GET /products/{id}/stock-movements: what moved the product's stock, newest
 * first, a page at a time. `locationId` narrows it to one location, and
 * `variantId` to one of the product's variants (another id is 400
 * `UNKNOWN_VARIANT`).
 *
 * A staff member limited to some locations sees the movements at those only,
 * never one the store recorded without a location; asking for another
 * location is 403 `LOCATION_NOT_ALLOWED`. A product out of reach is 404.
 *
 * Listed is what the store records: adjustments (from when the store's
 * Activity Log began), transfers, and returns put back on sale. Sales,
 * cancelled orders and refunds move stock too, and are not listed: the store
 * does not record where and when each took or gave back its units.
 */
export const StockMovementQuery = ListQuery.extend({
  locationId: z.string().min(1).max(64).optional(),
  variantId: z.string().min(1).max(64).optional(),
});
export type StockMovementQuery = z.infer<typeof StockMovementQuery>;

/**
 * Who moved the units:
 * - `person`: somebody of the operator's own team (on the store's side,
 *   anybody of the store's), with their `name` and, when recorded, their
 *   `role` (the store's word: `admin`, `staff`, or `vendor` for a seller);
 * - `store`: the marketplace's team, on a seller's product, shown to the
 *   seller and their staff without a name (their Activity Log leaves those
 *   rows out), and without the note they wrote;
 * - `system`: nobody recorded.
 */
export const StockMovementActor = z.object({
  kind: z.enum(["person", "store", "system"]),
  name: z.string().optional(),
  role: z.enum(["admin", "staff", "vendor"]).optional(),
});
export type StockMovementActor = z.infer<typeof StockMovementActor>;

/** One movement of a product's stock. */
export const StockMovement = z.object({
  /** Opaque; unique within the product's history. */
  id: z.string(),
  at: z.string(),
  kind: z.enum(STOCK_MOVEMENT_KINDS),
  /**
   * Units in (above 0) or out (below 0), as the store applied them: an
   * adjustment that would have gone below 0 shows what it actually took.
   */
  change: z.number().int(),
  /**
   * The units right after it, at its location, or in all when it has none.
   * Only adjustments record it.
   */
  quantityAfter: z.number().int().optional(),
  /** On a product with variants: the variant, and its name (as recorded, for one since deleted). */
  variantId: z.string().optional(),
  variantName: z.string().optional(),
  /**
   * Where. Left out when the store recorded none: an edit of a product's
   * whole count, or a return put back where it was sold from.
   */
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  /** An adjustment's reason, when it gave one (the website's inventory screens give none). */
  reason: z.enum(STOCK_ADJUSTMENT_REASONS).optional(),
  /**
   * An adjustment that set the count to `quantityAfter` (the website's
   * inventory screens), rather than adding or taking units.
   */
  set: z.boolean().optional(),
  /** The note written with an adjustment. */
  note: z.string().optional(),
  /** The transfer or the return it is part of, by its number. */
  reference: z
    .object({
      kind: z.enum(["transfer", "return"]),
      number: z.string(),
    })
    .optional(),
  actor: StockMovementActor,
});
export type StockMovement = z.infer<typeof StockMovement>;

export const StockMovementList = listOf(StockMovement);
export type StockMovementList = z.infer<typeof StockMovementList>;

/**
 * `reason` values of the product endpoints:
 * - PATCH /products/{id}: `PRICE_ON_REQUEST` (409: the product shows no price;
 *   change that on the website), `VARIANT_PRICES` (400: a product with
 *   variants is priced per variant), `UNKNOWN_VARIANT` (400).
 * - POST …/stock-adjustments: `LOCATION_NOT_ALLOWED` (403: not a location of
 *   this operator's), `VARIANT_REQUIRED` (400), `UNKNOWN_VARIANT` (400),
 *   `UNTRACKED` (409: stock is not counted for it).
 * - GET …/stock-movements: `LOCATION_NOT_ALLOWED` (403: a location outside
 *   the staff member's), `UNKNOWN_VARIANT` (400).
 */
export const PRODUCT_REASONS = [
  "PRICE_ON_REQUEST",
  "VARIANT_PRICES",
  "UNKNOWN_VARIANT",
  "LOCATION_NOT_ALLOWED",
  "VARIANT_REQUIRED",
  "UNTRACKED",
] as const;
export type ProductReason = (typeof PRODUCT_REASONS)[number];
