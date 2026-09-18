import "server-only";

import { Product } from "@/models";
import { ValidationError } from "@/lib/api/errors";
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
 */

type CartUpdateProduct = {
  stock?: number;
  /** Whether `stock` is a limit — see lib/products/stock-policy.ts. */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: PreorderSettingsShape;
  variants?: Array<{
    _id?: unknown;
    stock?: number;
    preorder?: PreorderSettingsShape;
  }>;
};

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

export async function setCartItemQuantity(
  cart: { items: MutableCartLine[] },
  line: { productId: string; variantId?: string; quantity: number },
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
    throw new ValidationError(
      "This price was quoted for a fixed quantity. Remove the item and request a new quote to change it.",
    );
  }

  const currentType = item.purchaseType || PURCHASE_TYPE.STANDARD;
  const product = await Product.findById(productId).lean<CartUpdateProduct>();
  if (!product) throw new ValidationError("Product not found");

  const purchase = resolvePurchaseType({
    product,
    variantId,
    requestedQuantity: quantity,
  });
  if (!purchase || purchase.purchaseType !== currentType) {
    throw new ValidationError("Insufficient stock");
  }
  const preorderTerms =
    purchase.purchaseType === PURCHASE_TYPE.PREORDER
      ? calculatePreorderDeposit({
          unitPrice: Number(item.price || 0),
          quantity,
          settings: getPreorderSettings(product, variantId),
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
