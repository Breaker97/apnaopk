import "server-only";

/**
 * What the cart's read endpoint needs to know about the products on it.
 *
 * Lives here rather than in the route so `countCartSellers` can be tested: it
 * has to agree exactly with `resolvePickupEligibility`, and a cart that shows
 * two seller groups while checkout says "one store" — or the reverse — is worse
 * than a cart that says nothing at all.
 */

import { Product } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { resolveItemShipping } from "@/lib/catalog/product-shipping";
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
};

export async function resolveCartProducts(
  items: CartProductLine[],
): Promise<Map<string, CartProductFacts>> {
  const facts = new Map<string, CartProductFacts>();
  if (!items.length) return facts;

  const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.productId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      "status productSource priceOnRequest shipping.isPhysicalProduct shipping.weight shipping.weightUnit variants._id variants.requiresShipping variants.weight variants.weightUnit vendorId",
    )
    // Only the store name: the cart names the seller, it does not link to a
    // full vendor profile, and a populate that pulls the whole document would
    // drag address and payout fields onto an endpoint that returns raw JSON.
    .populate("vendorId", "storeName")
    .lean<
      Array<{
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
          requiresShipping?: boolean;
          weight?: number;
          weightUnit?: "g" | "kg" | "lb" | "oz";
        }[];
        vendorId?: { _id?: unknown; storeName?: string } | null;
      }>
    >();

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

    facts.set(key, {
      visible:
        product.status === PRODUCT_STATUS.ACTIVE &&
        // A product switched to "price on request" after it was added is no
        // longer buyable at the price the line was captured at, so the line
        // leaves the cart the same way a deactivated product's does. Without
        // this it would sit there un-removable, priced from a quote the
        // shopper never got.
        !isQuoteOnlyProduct(product) &&
        isStorefrontProductSourceAllowed(
          product.productSource,
          isMultiVendorEnabled,
        ),
      requiresShipping: itemShipping.requiresShipping,
      unitWeight: itemShipping.unitWeight,
      // `?._id` rather than a plain truthiness check on `vendorId`: an
      // unpopulated ref is a bare ObjectId, which is truthy but has no
      // `storeName`. Treating that as a seller would draw a group header with
      // the fallback label instead of the store's name. A deleted vendor
      // populates to `null` and is handled by the same optional chain.
      vendorId: product.vendorId?._id
        ? String(product.vendorId._id)
        : undefined,
      vendorName: product.vendorId?.storeName || undefined,
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
 * One indexed lookup, on the same `{ vendorId, pickupEnabled, isActive }` index
 * the checkout branch list uses, with the same "must have an address" rule
 * `pickupLocationsForVendor` applies when it drops unusable branches.
 */
export async function anySellerOffersPickup(
  vendorIds: string[],
): Promise<boolean> {
  if (vendorIds.length === 0) return false;

  const { InventoryLocation } = await import(
    "@/models/inventory-location.model"
  );

  return Boolean(
    await InventoryLocation.exists({
      vendorId: { $in: vendorIds },
      pickupEnabled: true,
      isActive: { $ne: false },
      address: { $nin: [null, ""] },
    }),
  );
}

/** The distinct sellers of the bag's physical lines, for the lookup above. */
export function cartVendorIds(
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
