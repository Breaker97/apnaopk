import {
  getPreorderAvailability,
  getPreorderSettings,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import {
  getPurchasableQuantity,
  productAllowsOversell,
} from "@/lib/products/stock-policy";
import type {
  QuoteLotLimit,
  QuoteLotReason,
} from "@/lib/quotes/quote-lot-fit";

export type { QuoteLotLimit } from "@/lib/quotes/quote-lot-fit";

/**
 * How many units of a quoted product the cart will actually let the shopper
 * take — asked before a price goes out, so the merchant is not quoting a lot
 * that can never be checked out.
 *
 * The cart's answer comes from `resolvePurchaseType` (lib/orders/preorders.ts),
 * asked for a quoted line: buyable when the stock covers it, or when an open
 * pre-order has room for it. This restates that as a ceiling instead of a
 * yes/no for one quantity, because the send-price dialog checks the number
 * while it is being typed. `tests/quote-lot.test.ts` holds the two to the same
 * answer for every shape of product.
 *
 * Reasons, in the words the merchant sees them:
 *   stock          tracked stock with overselling off
 *   untracked      stock is not a limit, and a quoted lot is not held to the
 *                  per-line cap an ordinary cart has — no ceiling at all
 *   preorder       an open pre-order takes more than the stock does
 *   needs_variant  the product has variants and the quote names none — the
 *                  cart refuses a variant product added without one
 *   unavailable    the product (or the quoted variant) is gone or not active
 */

export type QuoteLotProduct = {
  status?: string;
  stock?: number;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: {
    tracked?: boolean;
    continueSellingWhenOutOfStock?: boolean;
  } | null;
  preorder?: PreorderSettingsShape;
  variants?: Array<{
    _id?: unknown;
    stock?: number;
    preorder?: PreorderSettingsShape;
  }>;
};

export function quoteLotLimit(
  product: QuoteLotProduct | null | undefined,
  variantId?: string | null,
): QuoteLotLimit {
  if (!product || product.status !== "active") {
    return { max: 0, reason: "unavailable" };
  }
  const variants = product.variants ?? [];
  if (variants.length > 0 && !variantId) {
    return { max: 0, reason: "needs_variant" };
  }
  const variant = variantId
    ? variants.find((candidate) => String(candidate._id) === String(variantId))
    : undefined;
  if (variantId && !variant) return { max: 0, reason: "unavailable" };

  const id = variantId ?? undefined;
  const untracked = productAllowsOversell(product);
  const standard = untracked
    ? Number.POSITIVE_INFINITY
    : getPurchasableQuantity(product, Number(variant?.stock ?? product.stock ?? 0));
  const standardReason: QuoteLotReason = untracked ? "untracked" : "stock";

  const preorder = getPreorderAvailability(product, id);
  const preorderRoom =
    preorder.windowOpen && preorder.remaining > 0 ? preorder.remaining : 0;
  const preorderOnly =
    Boolean(getPreorderSettings(product, id)?.preorderOnly) && preorderRoom > 0;

  if (preorderOnly || preorderRoom > standard) {
    return {
      max: Number.isFinite(preorderRoom) ? preorderRoom : null,
      reason: "preorder",
    };
  }
  return {
    max: Number.isFinite(standard) ? standard : null,
    reason: standardReason,
  };
}
