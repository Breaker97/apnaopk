import "server-only";

import { Product } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { CartRefusal, insufficientStock } from "@/lib/cart/cart-refusal";
import { getSettings } from "@/models/settings.model";
import {
  calculatePreorderDeposit,
  getPreorderSettings,
  PURCHASE_TYPE,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";

/**
 * Change how many of a cart line the shopper wants — the one way it is done.
 *
 * Two routes changed a line's quantity and only one of them did it properly.
 * `PUT /api/cart/items/[itemId]` checks stock, refuses to move a quoted lot,
 * and works a pre-order line's deposit and balance out again for the new
 * quantity. `PUT /api/cart` did none of it: it wrote the number and kept the
 * terms of the old one. Two units at 100 with a 20% deposit carry a balance of
 * 160; dropped to one unit, that balance exceeded the line, the amount due at
 * checkout came to nothing, and the pre-order was reserved with no deposit at
 * all. Both routes now come through here.
 *
 * Mutates the cart document in place; the caller saves it. Returns false when
 * no line matches.
 *
 * `admit` is the caller's own rule for the line, asked once the product and
 * the line's purchase type are known and before anything changes: it throws
 * a `CartRefusal` to refuse (the app takes no pre-orders, for one).
 */

type CartUpdateProduct = {
  stock?: number;
  /** Whether the product or a variant ships at all: read by `admit`. */
  shipping?: { isPhysicalProduct?: boolean };
  /** Whether `stock` is a limit — see lib/products/stock-policy.ts. */
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: PreorderSettingsShape;
  variants?: Array<{
    _id?: unknown;
    stock?: number;
    requiresShipping?: boolean;
    preorder?: PreorderSettingsShape;
  }>;
};

/** What `admit` is shown of a line before it is written. */
export type CartLineAdmission = {
  product: CartUpdateProduct;
  variantId?: string;
  purchaseType: string;
};
export type AdmitCartLine = (line: CartLineAdmission) => void;

type MutableCartLine = {
  productId: { toString: () => string };
  variantId?: { toString: () => string };
  quantity: number;
  price?: number;
  quoteId?: unknown;
  purchaseType?: string;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderPaymentMode?: string;
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
};

/**
 * Every line a whole number of units, at least one. The cart routes take only
 * whole numbers now; a line written before could still hold 1.5 — priced at
 * one and a half, and shipped as one or two.
 */
export function assertWholeQuantities(items: Array<{ quantity?: unknown }>): void {
  if (items.some((item) => !Number.isInteger(item.quantity) || Number(item.quantity) < 1)) {
    throw new ValidationError({
      cart: ["Each item's quantity must be a whole number"],
    });
  }
}

export async function setCartItemQuantity(
  cart: { items: MutableCartLine[] },
  line: { productId: string; variantId?: string; quantity: number },
  options: { admit?: AdmitCartLine } = {},
): Promise<boolean> {
  const { productId, variantId, quantity } = line;
  const itemIndex = cart.items.findIndex(
    (item) =>
      item.productId.toString() === productId &&
      (variantId ? item.variantId?.toString() === variantId : !item.variantId),
  );
  if (itemIndex === -1) return false;

  if (quantity <= 0) {
    cart.items.splice(itemIndex, 1);
    return true;
  }

  const item = cart.items[itemIndex];
  if (item.quoteId) {
    // A quoted line is priced for the exact lot the merchant quoted, so the
    // stepper cannot move it: changing the number would make the offer stop
    // resolving at checkout and the shopper would lose the price without
    // being told why. Removing the line is still allowed, above.
    throw new CartRefusal(
      "This price was quoted for a fixed quantity. Remove the item and request a new quote to change it.",
      "quoted_quantity",
    );
  }

  const currentType = item.purchaseType || PURCHASE_TYPE.STANDARD;
  const product = await Product.findById(productId).lean<CartUpdateProduct>();
  if (!product) throw new CartRefusal("Product not found", "not_available");

  const purchase = resolvePurchaseType({
    product,
    variantId,
    requestedQuantity: quantity,
  });
  if (!purchase || purchase.purchaseType !== currentType) {
    throw insufficientStock(product, variantId);
  }
  options.admit?.({ product, variantId, purchaseType: purchase.purchaseType });
  const preorderTerms =
    purchase.purchaseType === PURCHASE_TYPE.PREORDER
      ? calculatePreorderDeposit({
          unitPrice: Number(item.price || 0),
          quantity,
          settings: getPreorderSettings(product, variantId),
          currency: await storeCurrency(),
        })
      : undefined;

  item.quantity = quantity;
  item.preorderReleaseDate =
    "preorderReleaseDate" in purchase ? purchase.preorderReleaseDate : undefined;
  item.preorderMessage =
    "preorderMessage" in purchase ? purchase.preorderMessage : undefined;
  item.preorderPaymentMode = preorderTerms?.paymentMode;
  item.preorderDepositAmount = preorderTerms?.depositAmount;
  item.preorderOutstandingAmount = preorderTerms?.outstandingAmount;
  item.preorderSupplierEta =
    "preorderSupplierEta" in purchase ? purchase.preorderSupplierEta : undefined;
  item.preorderBatchName =
    "preorderBatchName" in purchase ? purchase.preorderBatchName : undefined;
  return true;
}

/**
 * The currency a cart line's pre-order deposit is rounded in — the store's,
 * which is the one checkout charges it in.
 */
export async function storeCurrency(): Promise<string> {
  const settings = await getSettings();
  return String(settings.general?.defaultCurrency || "USD").toUpperCase();
}
