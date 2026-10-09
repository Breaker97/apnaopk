import type { CartLine, CartReason, Cart as CartDto } from "@/contracts/mobile/shop/v1/cart";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import type { AdmitCartLine } from "@/lib/cart/cart-item-quantity";
import {
  CART_LINE_QUANTITY_LIMIT,
  CartRefusal,
  type CartRefusalReason,
} from "@/lib/cart/cart-refusal";
import {
  resolveCartIdentity,
  type CartIdentity,
  type CartView,
  type CartViewLine,
} from "@/lib/cart/cart-service";
import { formatVariantOptionLines } from "@/lib/cart/variant-options";
import { resolveItemShipping } from "@/lib/catalog/product-shipping";
import type { Currency } from "@/lib/intl/currencies";
import { PURCHASE_TYPE } from "@/lib/orders/preorders";
import type { MobileShopAppSettings } from "@/lib/settings/mobile-app";

/**
 * The app's side of the cart: whose cart a request opens, what the app may
 * not put in it, and the cart as the contract sends it. The rules themselves
 * are the cart service's (lib/cart/cart-service.ts), shared with the web.
 */

/** The account's cart when signed in, else the guest's, by `X-Cart-Token`. */
export function appCartIdentity(
  session: MobileSession | null,
  client: ClientInfo,
): CartIdentity | null {
  return resolveCartIdentity({ userId: session?.user.id, sessionId: client.cartToken });
}

/**
 * What the app may not put in a cart, on top of the store's rules: a
 * pre-order (the app cannot check one out in v1), and a line that does not
 * ship unless the store sells digital goods in its app (stores' in-app
 * purchase rules: Settings → Mobile app).
 */
export function admitInApp(shop: Pick<MobileShopAppSettings, "allowDigitalPurchases">): AdmitCartLine {
  return ({ product, variantId, purchaseType }) => {
    if (purchaseType === PURCHASE_TYPE.PREORDER) {
      throw new CartRefusal("Pre-orders cannot be placed in the app yet.", "pre_order");
    }
    if (shop.allowDigitalPurchases) return;
    const variant = variantId
      ? product.variants?.find((candidate) => String(candidate._id) === variantId)
      : undefined;
    const { requiresShipping } = resolveItemShipping({
      productShipping: product.shipping,
      variantShipping: { requiresShipping: variant?.requiresShipping },
    });
    if (!requiresShipping) {
      throw new CartRefusal("This product cannot be bought in the app.", "not_purchasable_in_app");
    }
  };
}

const CONTRACT_REASON: Record<CartRefusalReason, CartReason> = {
  not_available: "NOT_AVAILABLE",
  variant_required: "VARIANT_REQUIRED",
  price_on_request: "PRICE_ON_REQUEST",
  out_of_stock: "OUT_OF_STOCK",
  quantity_limited: "QUANTITY_LIMITED",
  mixed_purchase_types: "MIXED_PURCHASE_TYPES",
  cart_full: "CART_FULL",
  quoted_quantity: "QUOTED_QUANTITY",
  pre_order: "PRE_ORDER",
  not_purchasable_in_app: "NOT_PURCHASABLE_IN_APP",
};

/**
 * Runs a cart change, answering a refused line as the contract words it: 409
 * CONFLICT with the cart's reason, and `maxQuantity` when fewer are left.
 */
export async function withCartReasons<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change();
  } catch (error) {
    if (!(error instanceof CartRefusal)) throw error;
    throw new MobileApiError(409, "CONFLICT", error.message, {
      reason: CONTRACT_REASON[error.reason],
      ...(error.maxQuantity !== undefined ? { details: { maxQuantity: error.maxQuantity } } : {}),
    });
  }
}

/** A cart line's key: the product, and its variant after a dash. */
export function cartLineKeyOf(productId: string, variantId?: string): string {
  return variantId ? `${productId}-${variantId}` : productId;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** The line a key names, or null for a key no line can have. */
export function parseCartLineKey(key: string): { productId: string; variantId?: string } | null {
  const [productId, variantId, extra] = key.split("-");
  if (extra !== undefined || !OBJECT_ID.test(productId ?? "")) return null;
  if (variantId !== undefined && !OBJECT_ID.test(variantId)) return null;
  return { productId, variantId };
}

type AppCartContext = {
  currency: Pick<Currency, "code" | "locale">;
  shop: Pick<MobileShopAppSettings, "allowDigitalPurchases">;
  /** Set when this request created the guest's cart. */
  cartToken?: string;
};

/**
 * Why a line cannot be checked out in the app as it stands. A quoted line's
 * quantity is the merchant's lot, which checkout judges against the offer, so
 * only whether anything is left is asked of it here.
 */
function lineReason(line: CartViewLine, ctx: AppCartContext): CartReason | undefined {
  const { item, facts, quoted } = line;
  if (item.purchaseType === PURCHASE_TYPE.PREORDER) return "PRE_ORDER";
  if (!ctx.shop.allowDigitalPurchases && facts?.requiresShipping === false) {
    return "NOT_PURCHASABLE_IN_APP";
  }
  const purchasable = facts?.app?.purchasable ?? 0;
  if (purchasable <= 0) return "OUT_OF_STOCK";
  if (!quoted && item.quantity > purchasable) return "QUANTITY_LIMITED";
  return undefined;
}

function toCartLine(line: CartViewLine, ctx: AppCartContext): CartLine {
  const { item, facts, quoted } = line;
  const productId = String(item.productId);
  const variantId = item.variantId ? String(item.variantId) : undefined;
  const isPreorder = item.purchaseType === PURCHASE_TYPE.PREORDER;
  const purchasable = facts?.app?.purchasable ?? 0;
  const variantLabel = formatVariantOptionLines({
    variantOptions: facts?.variantOptions,
    variantName: typeof item.variantName === "string" ? item.variantName : undefined,
  }).join(", ");
  const compareAt = facts?.app?.compareAtPrice;
  const reason = lineReason(line, ctx);
  // The picture captured with the line: the variant's, else the product's.
  const image = imageSet(typeof item.image === "string" ? item.image : undefined);

  return {
    key: cartLineKeyOf(productId, variantId),
    productId,
    ...(variantId ? { variantId } : {}),
    slug: facts?.app?.slug ?? "",
    name: String(item.name ?? ""),
    ...(variantLabel ? { variantLabel } : {}),
    ...(image ? { image } : {}),
    quantity: item.quantity,
    // A quoted lot and a pre-order cannot be changed in the app, only removed.
    maxQuantity:
      quoted || isPreorder
        ? item.quantity
        : Math.min(purchasable, CART_LINE_QUANTITY_LIMIT),
    unitPrice: toMoney(item.price, ctx.currency),
    ...(!quoted && compareAt !== undefined && compareAt > item.price
      ? { compareAtUnitPrice: toMoney(compareAt, ctx.currency) }
      : {}),
    lineTotal: toMoney(item.price * item.quantity, ctx.currency),
    availability: isPreorder ? "PRE_ORDER" : purchasable > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
    ...(facts?.vendorName && facts.app?.vendorSlug
      ? { vendor: { name: facts.vendorName, slug: facts.app.vendorSlug } }
      : {}),
    ...(reason ? { reason } : {}),
  };
}

/** The cart as the contract sends it (`Cart`), from the cart service's view. */
export function toAppCart(view: CartView, ctx: AppCartContext): CartDto {
  return {
    lines: view.lines.map((line) => toCartLine(line, ctx)),
    itemCount: view.totalItems,
    subtotal: toMoney(view.subtotal, ctx.currency),
    ...(ctx.cartToken ? { cartToken: ctx.cartToken } : {}),
  };
}

/** The cart of somebody who has none yet. */
export function emptyAppCart(currency: Pick<Currency, "code" | "locale">): CartDto {
  return { lines: [], itemCount: 0, subtotal: toMoney(0, currency) };
}
