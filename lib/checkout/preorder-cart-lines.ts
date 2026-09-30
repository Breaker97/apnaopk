import { ValidationError } from "@/lib/api/errors";
import { roundMoney } from "@/lib/intl/money";
import { cartLinePriceChanged } from "@/lib/checkout/cart-price-change";
import {
  calculatePreorderDeposit,
  getPreorderAvailability,
  getPreorderSettings,
  preorderQuotaVariantId,
} from "@/lib/orders/preorders";

/**
 * What both payment routes do to a pre-order cart line before charging it.
 *
 * A cart lives for weeks and a pre-order line used to keep everything it was
 * added with: the price, the deposit terms, the release date. Standard lines
 * were re-priced from the live product; pre-order lines were not, on the
 * belief that their terms were fixed "at reservation" — but adding to a cart
 * reserves nothing. A line added at 100 with a 20% deposit was still paid as
 * a 20 deposit a month later, after the store had raised the price to 150 and
 * switched to full payment; and a release date the store had pushed back went
 * onto the order, and into the card authorisation, as the old one.
 *
 * So a pre-order line is priced and termed from the live product at checkout,
 * and a change stops the checkout the way a standard line's price change does:
 * the new terms are written to the cart and the shopper decides again.
 */

type Product = Omit<Parameters<typeof getPreorderSettings>[0], "variants"> & {
  price?: number;
  variants?: Array<
    NonNullable<Parameters<typeof getPreorderSettings>[0]["variants"]>[number] & {
      price?: number;
    }
  >;
};

type MutablePreorderLine = {
  variantId?: unknown;
  quantity: number;
  price: number;
  preorderReleaseDate?: Date | string;
  preorderMessage?: string;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date | string;
  preorderBatchName?: string;
};

type PreorderPurchase = {
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
};

function livePrice(product: Product, variantId: string | undefined, fallback: number) {
  const variant = variantId
    ? product.variants?.find((candidate) => String(candidate._id) === variantId)
    : undefined;
  if (variant && typeof variant.price === "number") return variant.price;
  if (typeof product.price === "number") return product.price;
  return fallback;
}

function time(value: unknown): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value as string | Date).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Re-price and re-term one pre-order line from the live product, in place.
 * `changed` is true when anything the shopper was shown moved.
 */
export function refreshPreorderCartLine(params: {
  item: MutablePreorderLine;
  product: Product;
  purchase: PreorderPurchase;
  currency: string;
}): { changed: boolean; previousPrice: number; price: number } {
  const { item, product, purchase } = params;
  const variantId = item.variantId ? String(item.variantId) : undefined;
  const previousPrice = item.price;
  const price = livePrice(product, variantId, item.price);
  const terms = calculatePreorderDeposit({
    unitPrice: price,
    quantity: item.quantity,
    settings: getPreorderSettings(product, variantId),
    currency: params.currency,
  });

  const changed =
    cartLinePriceChanged(item.price, price) ||
    (item.preorderPaymentMode || "full") !== terms.paymentMode ||
    roundMoney(Number(item.preorderDepositAmount || 0)) !==
      roundMoney(terms.depositAmount) ||
    roundMoney(Number(item.preorderOutstandingAmount || 0)) !==
      roundMoney(terms.outstandingAmount) ||
    time(item.preorderReleaseDate) !== time(purchase.preorderReleaseDate);

  item.price = price;
  item.preorderPaymentMode = terms.paymentMode;
  item.preorderDepositAmount = terms.depositAmount;
  item.preorderOutstandingAmount = terms.outstandingAmount;
  item.preorderReleaseDate = purchase.preorderReleaseDate;
  item.preorderMessage = purchase.preorderMessage;
  item.preorderSupplierEta = purchase.preorderSupplierEta;
  item.preorderBatchName = purchase.preorderBatchName;

  return { changed, previousPrice, price };
}

/** The cart fields a refreshed pre-order line writes back, for a positional `$set`. */
export function preorderLineCartSet(
  item: MutablePreorderLine,
  path: (field: string) => string,
): Record<string, unknown> {
  return {
    [path("preorderPaymentMode")]: item.preorderPaymentMode,
    [path("preorderDepositAmount")]: item.preorderDepositAmount,
    [path("preorderOutstandingAmount")]: item.preorderOutstandingAmount,
    [path("preorderReleaseDate")]: item.preorderReleaseDate,
    [path("preorderMessage")]: item.preorderMessage,
    [path("preorderSupplierEta")]: item.preorderSupplierEta,
    [path("preorderBatchName")]: item.preorderBatchName,
  };
}

/**
 * Refuse a cart whose pre-order lines together ask for more places than are
 * left.
 *
 * Each line was checked against the whole remaining count on its own, but
 * variants without pre-order settings of their own share the product's
 * counter: 5 places left, sizes S x3 and M x3, and both lines passed. The
 * money was captured, the reservation then failed on the second line, and the
 * whole order was cancelled and refunded. Summed per counter here, before any
 * gateway is asked for anything.
 */
export function assertCartPreorderQuota(
  lines: Array<{
    productId: string;
    product: Product;
    variantId?: string;
    quantity: number;
    name: string;
  }>,
): void {
  const byCounter = new Map<
    string,
    { quantity: number; remaining: number; name: string }
  >();
  for (const line of lines) {
    const key = `${line.productId}:${preorderQuotaVariantId(line.product, line.variantId) ?? ""}`;
    const entry = byCounter.get(key) || {
      quantity: 0,
      remaining: getPreorderAvailability(line.product, line.variantId).remaining,
      name: line.name,
    };
    entry.quantity += line.quantity;
    byCounter.set(key, entry);
  }
  for (const entry of byCounter.values()) {
    if (entry.quantity > entry.remaining) {
      // A sentence, not a field map: checkout shows a refusal's message, and
      // a field map's message is only "Validation failed: stock".
      throw new ValidationError(
        `Only ${Math.max(0, entry.remaining)} of ${entry.name} can still be pre-ordered, across all its options in your cart`,
      );
    }
  }
}
