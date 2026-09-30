import "server-only";

/**
 * What the cart's read endpoint needs to know about the products on it.
 *
 * Lives here rather than in the route so `countCartSellers` can be tested: it
 * has to agree exactly with `resolvePickupEligibility`, and a cart that shows
 * two seller groups while checkout says "one store" — or the reverse — is worse
 * than a cart that says nothing at all.
 */

import { mongoose } from "@/lib/db";
import { InventoryLocation, Product, Vendor } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  resolveVariantOptions,
  type CartVariantOption,
} from "@/lib/cart/variant-options";
import { resolveItemShipping } from "@/lib/catalog/product-shipping";
import { isFinalSaleProduct } from "@/lib/returns/final-sale";
import {
  readCartFinalSale,
  type CartFinalSale,
} from "@/lib/returns/final-sale-collections";
import { CANONICAL_CART_WEIGHT_UNIT } from "@/lib/shipping/shipping";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";

/** The subset of a stored cart line these helpers read. */
type CartProductLine = {
  productId?: { toString: () => string } | string | null;
  variantId?: { toString: () => string } | string | null;
};

/**
 * Identity of a cart LINE, not of a product.
 *
 * Facts are cached per line because one of them — `requiresShipping` — is a
 * property of the variant, not the product: `models/product.model.ts` gives
 * each variant its own `requiresShipping`, and a shop selling a book as both a
 * PDF and a paperback has two lines of one product with opposite answers.
 * Caching those per product collapsed them onto whichever line came first,
 * which is how a cart needing an address reported itself digital-only and left
 * checkout with no address field and an order route that refuses to submit.
 */
export function cartLineKey(item: CartProductLine): string {
  return `${item.productId?.toString() ?? ""}::${item.variantId?.toString() ?? ""}`;
}

/**
 * What the cart needs to know about the products on it, in one pass.
 *
 * This used to be two separate `Product.find` calls over the same ids — one for
 * visibility, one for shippability — which meant the seller could not be
 * reported without a third. Merging them makes vendor identity free: the
 * documents were already being loaded, just not asked for it.
 */
type CartProductFacts = {
  visible: boolean;
  requiresShipping: boolean;
  /**
   * Weight of ONE unit of this line, already converted to the unit every
   * shipping call site aggregates in. Carried here so the cart endpoint can
   * report a cart weight, which is what lets checkout show a weight-based rate
   * before the server quote lands instead of quoting one against zero.
   */
  unitWeight: number;
  vendorId?: string;
  vendorName?: string;
  /**
   * Whether this line's seller runs a collection point a shopper can use —
   * see `anySellerOffersPickup`. Only set alongside `vendorId`.
   */
  vendorOffersPickup?: boolean;
  /**
   * What the shopper chose on this line — "Color: White", "Size: M" — as
   * name/value pairs. Resolved from the product for the same reason the seller
   * name is: the stored `variantName` is a flat "White / M" that has forgotten
   * which half is the colour, and renaming an option should re-caption the
   * lines already in the bag. Empty for a line with no variant.
   */
  variantOptions?: CartVariantOption[];
  /**
   * Sold as final sale — the shopper cannot return it — so the cart and
   * checkout can say so before they pay. See lib/returns/final-sale.ts.
   */
  finalSale?: boolean;
};

type CartProductRow = {
  _id: { toString: () => string };
  status?: string;
  productSource?: unknown;
  priceOnRequest?: boolean;
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
  };
  variants?: {
    _id: { toString: () => string };
    name?: string;
    optionValues?: Array<string | { optionName?: string; value?: string }>;
    requiresShipping?: boolean;
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
    finalSale?: boolean;
  }[];
  options?: { name?: string }[];
  returns?: { finalSale?: boolean };
  collectionIds?: unknown[];
  /** The seller, if it still exists: only its store name. */
  vendor: { _id: unknown; storeName?: string }[];
  /** One of the seller's usable collection points, if it has any. */
  pickupLocations: unknown[];
};

/** What `readCartProducts` read, for `cartProductFacts`. */
type CartProductRows = {
  isMultiVendorEnabled: boolean;
  products: CartProductRow[];
  /** Final sale by collection, hand-picked or by an automated one's rules. */
  finalSale?: CartFinalSale;
};

/**
 * Read what the cart needs about the products on it: one query.
 *
 * The seller's store name and whether it runs a collection point are joined
 * in, rather than read after: they were a populate and then a lookup, each
 * waiting on the one before it, on an endpoint every page load calls. The
 * join asks for exactly what they asked — only the store name (the cart names
 * the seller, it does not link to a full vendor profile, and pulling the
 * whole document would drag address and payout fields onto an endpoint that
 * returns raw JSON), and a branch on the same `{ vendorId, pickupEnabled,
 * isActive }` index the checkout branch list uses, with the same "must have
 * an address" rule `pickupLocationsForVendor` applies when it drops unusable
 * branches.
 *
 * Final sale by collection is read alongside: the store's final-sale
 * collections come from the cache, and only a store with an automated one
 * matches these products against its rules (`readCartFinalSale`).
 *
 * Needs nothing from the shopper's session, so a caller can run it alongside
 * the shopper's quote offers and hand both to `cartProductFacts`.
 */
export async function readCartProducts(
  items: CartProductLine[],
): Promise<CartProductRows> {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.productId?.toString())
        .filter((id): id is string => Boolean(id && mongoose.isValidObjectId(id))),
    ),
  );
  if (!productIds.length) return { isMultiVendorEnabled: false, products: [] };

  const [isMultiVendorEnabled, products, finalSale] = await Promise.all([
    isStorefrontMultiVendorEnabled(),
    Product.aggregate<CartProductRow>([
      {
        $match: {
          _id: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) },
        },
      },
      {
        $project: {
          status: 1,
          productSource: 1,
          priceOnRequest: 1,
          "shipping.isPhysicalProduct": 1,
          "shipping.weight": 1,
          "shipping.weightUnit": 1,
          "variants._id": 1,
          "variants.name": 1,
          "variants.optionValues": 1,
          "variants.requiresShipping": 1,
          "variants.weight": 1,
          "variants.weightUnit": 1,
          "variants.finalSale": 1,
          "options.name": 1,
          "returns.finalSale": 1,
          collectionIds: 1,
          vendorId: 1,
        },
      },
      {
        $lookup: {
          from: Vendor.collection.name,
          localField: "vendorId",
          foreignField: "_id",
          pipeline: [{ $project: { storeName: 1 } }],
          as: "vendor",
        },
      },
      {
        $lookup: {
          from: InventoryLocation.collection.name,
          localField: "vendorId",
          foreignField: "vendorId",
          pipeline: [
            {
              $match: {
                pickupEnabled: true,
                isActive: { $ne: false },
                address: { $nin: [null, ""] },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "pickupLocations",
        },
      },
    ]),
    // The store's final-sale collections, and the automated ones these
    // products join by their rules — from the cache, then (only if the store
    // has such a collection) matched alongside this read.
    readCartFinalSale(productIds),
  ]);

  return { isMultiVendorEnabled, products, finalSale };
}

/**
 * `quotedLineKeys` names the lines a live quote offer covers, by
 * `cartLineKey`. They are the only reason a "price on request" product may
 * stay in a cart, so the caller resolves them (it has the shopper's session;
 * this module does not) and hands them in — see lib/quotes/quote-offer.ts.
 */
type CartProductFactsOptions = {
  quotedLineKeys?: ReadonlySet<string>;
};

/** The facts for each line of the cart, from what `readCartProducts` read. */
export function cartProductFacts(
  items: CartProductLine[],
  { isMultiVendorEnabled, products, finalSale }: CartProductRows,
  options: CartProductFactsOptions = {},
): Map<string, CartProductFacts> {
  const facts = new Map<string, CartProductFacts>();
  const byId = new Map(products.map((row) => [row._id.toString(), row]));

  for (const item of items) {
    const id = item.productId?.toString();
    const key = cartLineKey(item);
    if (!id || facts.has(key)) continue;

    const product = byId.get(id);
    if (!product) {
      // Unknown product: invisible, but assumed shippable so a missing row
      // never silently hides the checkout address step.
      facts.set(key, { visible: false, requiresShipping: true, unitWeight: 0 });
      continue;
    }

    const variant = item.variantId
      ? product.variants?.find(
          (v) => v._id.toString() === item.variantId?.toString(),
        )
      : undefined;

    const itemShipping = resolveItemShipping({
      productShipping: product.shipping,
      variantShipping: {
        requiresShipping: variant?.requiresShipping,
        weight: variant?.weight,
        weightUnit: variant?.weightUnit,
      },
      targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
    });

    // A deleted seller joins nothing, and its line then has no seller at all:
    // counting it would invent a second seller and draw a group header with
    // the fallback label instead of a store's name.
    const vendor = product.vendor[0];

    facts.set(key, {
      visible:
        product.status === PRODUCT_STATUS.ACTIVE &&
        // A product switched to "price on request" after it was added is no
        // longer buyable at the price the line was captured at, so the line
        // leaves the cart the same way a deactivated product's does. Without
        // this it would sit there un-removable, priced from a quote the
        // shopper never got.
        //
        // Unless this shopper holds a live offer for exactly this line, which
        // is the one way a quoted product is legitimately in a cart. The offer
        // expiring, being withdrawn or being spent on an order takes the key
        // away again, and the line is pruned on the next read.
        (!isQuoteOnlyProduct(product) ||
          (options.quotedLineKeys?.has(key) ?? false)) &&
        isStorefrontProductSourceAllowed(
          product.productSource,
          isMultiVendorEnabled,
        ),
      requiresShipping: itemShipping.requiresShipping,
      unitWeight: itemShipping.unitWeight,
      vendorId: vendor ? String(vendor._id) : undefined,
      vendorName: vendor?.storeName || undefined,
      vendorOffersPickup: vendor
        ? product.pickupLocations.length > 0
        : undefined,
      variantOptions: variant
        ? resolveVariantOptions(variant, product.options)
        : undefined,
      // A download never comes back in the first place, so only goods are
      // called final sale.
      finalSale:
        itemShipping.requiresShipping &&
        isFinalSaleProduct(
          product,
          item.variantId?.toString(),
          finalSale?.collectionIds ?? [],
          finalSale?.byRule.get(id),
        ),
    });
  }

  return facts;
}

/**
 * How many distinct sellers the shopper's *visible* lines come from.
 *
 * Counted over physical lines only, and over the filtered set, matching
 * `resolvePickupEligibility` exactly — it is what decides `multi_vendor`, and a
 * cart that displays two seller groups while checkout says "one store" (or the
 * reverse) is worse than saying nothing. A digital line has no collection
 * question to answer, so it does not make a cart "mixed".
 */
export function countCartSellers(
  items: CartProductLine[],
  facts: Map<string, CartProductFacts>,
): number {
  return cartVendorIds(items, facts).length;
}

/**
 * Does anyone in this bag actually run a collection point?
 *
 * The mixed-cart notice tells a shopper the seller mix is why their order will
 * be delivered. That is only true if collection was on offer in the first
 * place: `resolvePickupEligibility` short-circuits on `multi_vendor` BEFORE it
 * looks at a single branch, so "more than one seller" says nothing about
 * whether either of them has a counter. In a store where no merchant has set
 * one up — the default state of a fresh install — the notice would blame the
 * mix for something that never existed.
 *
 * Asked of the same lines `cartVendorIds` counts — physical ones with a
 * seller — from the branch `readCartProducts` joined in for each seller.
 */
export function anySellerOffersPickup(
  items: CartProductLine[],
  facts: Map<string, CartProductFacts>,
): boolean {
  return items.some((item) => {
    const fact = facts.get(cartLineKey(item));
    return Boolean(
      fact?.requiresShipping && fact.vendorId && fact.vendorOffersPickup,
    );
  });
}

/** The distinct sellers of the bag's physical lines. */
function cartVendorIds(
  items: CartProductLine[],
  facts: Map<string, CartProductFacts>,
): string[] {
  const vendors = new Set<string>();

  for (const item of items) {
    const fact = facts.get(cartLineKey(item));
    if (!fact?.requiresShipping || !fact.vendorId) continue;
    vendors.add(fact.vendorId);
  }

  return [...vendors];
}
