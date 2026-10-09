import type { Availability } from "@/contracts/mobile/shop/v1/catalog";
import { CART_LINE_QUANTITY_LIMIT } from "@/lib/cart/cart-refusal";
import { resolveItemShipping } from "@/lib/catalog/product-shipping";
import {
  getPreorderAvailability,
  getPreorderSettings,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import {
  getPurchasableQuantity,
  isProductAvailable,
  type StockPolicySource,
} from "@/lib/products/stock-policy";

/**
 * Whether a product can be bought, as the app is told it (`availability`,
 * `maxQuantity`, `purchasableInApp`). Composed from the store's own rules,
 * never decided here: stock from lib/products/stock-policy.ts, pre-orders
 * from lib/orders/preorders.ts (checkout's `resolvePurchaseType`).
 */


type SelectionVariant = {
  _id?: unknown;
  stock?: number;
  preorder?: PreorderSettingsShape;
  requiresShipping?: boolean;
};

export type AvailabilitySource = StockPolicySource & {
  stock?: number;
  preorder?: PreorderSettingsShape;
  variants?: SelectionVariant[] | null;
};

/**
 * Whether buying this selection now would be a pre-order: the pre-order is
 * open with places left, and it is pre-order only or stock cannot cover a
 * unit. Checkout's own rule, and the one the web's card and buy box show.
 */
function sellsAsPreorder(
  product: AvailabilitySource,
  variantId: string | undefined,
  stock: number | undefined,
): boolean {
  const source = product as Parameters<typeof getPreorderAvailability>[0];
  const { enabled, windowOpen, remaining } = getPreorderAvailability(source, variantId);
  if (!enabled || !windowOpen || remaining <= 0) return false;
  return (
    Boolean(getPreorderSettings(source, variantId)?.preorderOnly) ||
    getPurchasableQuantity(product, stock) <= 0
  );
}

/** One variant's state, or a product's that has none. */
export function selectionAvailability(
  product: AvailabilitySource,
  variant?: SelectionVariant,
): Availability {
  const stock = variant ? variant.stock : product.stock;
  if (sellsAsPreorder(product, variant ? String(variant._id) : undefined, stock)) {
    return "PRE_ORDER";
  }
  return isProductAvailable(product, stock) ? "IN_STOCK" : "OUT_OF_STOCK";
}

/**
 * A product's state as a card shows it: a pre-order when any of its variants
 * would sell as one, else in stock or not by the product's stock (the web
 * card's badge, components/products/modern-product-card.tsx).
 */
export function productAvailability(product: AvailabilitySource): Availability {
  const variants = product.variants ?? [];
  const preorder =
    variants.length === 0
      ? sellsAsPreorder(product, undefined, product.stock)
      : variants.some((variant) => sellsAsPreorder(product, String(variant._id), variant.stock));
  if (preorder) return "PRE_ORDER";
  return isProductAvailable(product, product.stock) ? "IN_STOCK" : "OUT_OF_STOCK";
}

/**
 * Whether the app may sell this selection: anything that ships, and goods
 * that do not (downloads, services) only when the store allows them in its
 * app (Settings → Mobile app). The cart applies the same rule
 * (lib/api-core/shop/cart).
 */
export function purchasableInApp(
  product: AvailabilitySource,
  allowDigitalPurchases: boolean,
  variant?: SelectionVariant,
): boolean {
  if (allowDigitalPurchases) return true;
  return resolveItemShipping({
    productShipping: product.shipping ?? undefined,
    variantShipping: { requiresShipping: variant?.requiresShipping },
  }).requiresShipping;
}

/**
 * The most the shopper may put in the cart from the app: 0 for anything the
 * app cannot sell now (out of stock, a pre-order, which v1 of the app does
 * not take, a quote-only product, digital goods the store keeps out of its
 * app); else what stock allows, at most the cart's per-line cap.
 */
export function appMaxQuantity(
  product: AvailabilitySource,
  options: { availability: Availability; sellable: boolean; stock: number | undefined },
): number {
  if (!options.sellable || options.availability !== "IN_STOCK") return 0;
  return Math.min(getPurchasableQuantity(product, options.stock), CART_LINE_QUANTITY_LIMIT);
}
