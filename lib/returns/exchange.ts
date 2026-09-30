import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { isDigitalProduct } from "@/lib/products/stock-policy";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { RETURN_STATUS } from "@/lib/returns/returns";

/**
 * Exchanges (R7): a return the store processes into a new order instead of
 * sending the money back — Shopify's exchange, made a separate linked order so
 * the returned order's consignments, ledger and payouts are never re-cut.
 *
 * The store picks what goes out when it approves the return. Nothing is priced
 * for good or taken from stock until the return is processed; then the
 * return's value pays for the exchange order first. What that leaves the
 * shopper to pay goes out as a pay link, and what it leaves over is refunded
 * the ordinary way.
 *
 * Pure and free of `server-only`, so the admin dialog, the routes and the tests
 * price an exchange the same way.
 */

/** More lines than an exchange plausibly needs; the form stops here. */
export const EXCHANGE_MAX_LINES = 20;

type ExchangeLine = { unitPrice: number; quantity: number };

export type ExchangePrice = {
  subtotal: number;
  /** The tax rate charged, as a percentage — the returned order's. */
  taxRate: number;
  tax: number;
  shipping: number;
  total: number;
};

type ExchangeSplit = {
  /** What of the return pays for the exchange order. */
  credit: number;
  /** What the shopper still has to pay, by pay link. */
  owed: number;
  /** What is left of the return once the exchange is paid, refunded as usual. */
  rest: number;
};

const positive = (value: unknown) => Math.max(0, Number(value) || 0);

/**
 * The tax rate the returned order charged on its goods, as a percentage: the
 * exchange is taxed the same (the store's rule, 2026-09-29). Checkout taxes
 * the goods after their discount and never the delivery, so that is what the
 * tax is measured against; a free-shipping coupon's discount was delivery.
 * An order with nothing taxable says nothing about a rate, and the store's
 * rate of today stands in.
 */
export function exchangeTaxRate(
  order: {
    subtotal?: number | null;
    discount?: number | null;
    tax?: number | null;
    coupon?: { type?: string | null } | null;
  },
  fallbackPercent: number,
): number {
  const goodsDiscount = isFreeShippingCouponType(order.coupon?.type)
    ? 0
    : positive(order.discount);
  const taxable = positive(order.subtotal) - goodsDiscount;
  const tax = positive(order.tax);
  if (!(taxable > 0.005)) return positive(fallbackPercent);
  // Four decimals of a percent: enough to rebuild a tax rounded to the cent.
  return Math.round((tax / taxable) * 100 * 10_000) / 10_000;
}

/**
 * The exchange order's own figures, worked out as `createAdminOrder` works
 * them out when it makes the order — no order-wide discount, the returned
 * order's tax rate on the goods, and the delivery the store set.
 */
export function priceExchange(params: {
  lines: ReadonlyArray<ExchangeLine>;
  /** A percentage. */
  taxRate: number;
  delivery?: number | null;
  currency: string;
}): ExchangePrice {
  const subtotal = roundMoney(
    params.lines.reduce(
      (sum, line) => sum + positive(line.unitPrice) * Math.max(0, Math.floor(Number(line.quantity) || 0)),
      0,
    ),
  );
  const taxRate = positive(params.taxRate);
  const tax = quantizeToCurrency(subtotal * (taxRate / 100), params.currency);
  const shipping = quantizeToCurrency(positive(params.delivery), params.currency);
  return {
    subtotal,
    taxRate,
    tax,
    shipping,
    total: quantizeToCurrency(subtotal + tax + shipping, params.currency),
  };
}

/**
 * How the return's value and the exchange order meet: the return pays first,
 * the shopper pays what is short, and what is over goes back.
 */
export function exchangeSplit(params: {
  /** What is left of the return to refund. */
  returnLeft: number;
  total: number;
  currency: string;
}): ExchangeSplit {
  const left = quantizeToCurrency(positive(params.returnLeft), params.currency);
  const total = quantizeToCurrency(positive(params.total), params.currency);
  const credit = Math.min(left, total);
  return {
    credit,
    owed: quantizeToCurrency(total - credit, params.currency),
    rest: quantizeToCurrency(left - credit, params.currency),
  };
}

type ExchangeState = {
  orderId?: unknown;
  undoneAt?: Date | string | null;
} | null;

/** Whether the return has become an exchange order that still stands. */
export function hasActiveExchange(returnRequest: { exchange?: ExchangeState }): boolean {
  return Boolean(returnRequest.exchange?.orderId) && !returnRequest.exchange?.undoneAt;
}

/** How long a return stays claimed by an exchange being processed on it. */
export const EXCHANGE_CLAIM_MS = 10 * 60 * 1000;

/**
 * The return has no exchange standing and none being made — what the claim
 * that processes an exchange writes under, so two sent together make one
 * order. A claim left by a crashed request goes stale.
 */
export function exchangeFreeOnReturn(now: Date = new Date()) {
  return {
    $and: [
      {
        $or: [
          { "exchange.orderId": { $exists: false } },
          { "exchange.undoneAt": { $exists: true, $ne: null } },
        ],
      },
      {
        $or: [
          { exchangeClaimedAt: { $exists: false } },
          { exchangeClaimedAt: null },
          { exchangeClaimedAt: { $lt: new Date(now.getTime() - EXCHANGE_CLAIM_MS) } },
        ],
      },
    ],
  };
}

/** Whether this order is the exchange for a return, and still stands as one. */
export function isActiveExchangeOrder(order: {
  exchangeOf?: { returnId?: unknown; undoneAt?: Date | string | null } | null;
} | null | undefined): boolean {
  return Boolean(order?.exchangeOf?.returnId) && !order?.exchangeOf?.undoneAt;
}

/**
 * Whether the goods are back — counted, or marked received — or never had to
 * come: an exchange is processed then, as Shopify processes one, and not on
 * the strength of a parcel still on its way.
 */
export function exchangeReadyToProcess(returnRequest: {
  receivedAt?: Date | string | null;
  itemsCountedAt?: Date | string | null;
  returnMethod?: string | null;
}): boolean {
  return (
    Boolean(returnRequest.receivedAt || returnRequest.itemsCountedAt) ||
    String(returnRequest.returnMethod || "") === "no_shipping"
  );
}

const CLOSED_STATUSES = new Set<string>([
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.CANCELLED,
  RETURN_STATUS.CLOSED,
  RETURN_STATUS.REFUNDED,
]);

/**
 * Why this return cannot be exchanged at all, or null when it can. The same
 * limits Shopify sets, and the marketplace's own: one seller, whose money it is.
 */
export function exchangeReturnProblem(params: {
  returnRequest: {
    status?: string | null;
    refundPayer?: string | null;
    vendorIds?: ReadonlyArray<unknown> | null;
    exchange?: ExchangeState;
  };
  order: {
    currency?: string | null;
    customs?: { dutyAmount?: number | null } | null;
  };
  /** The currency the store sells in now, which a new order is made in. */
  storeCurrency: string;
}): string | null {
  const { returnRequest, order } = params;
  if (hasActiveExchange(returnRequest)) {
    return "This return has already been exchanged.";
  }
  if (CLOSED_STATUSES.has(String(returnRequest.status || ""))) {
    return "This return is finished, so it can no longer be exchanged.";
  }
  const vendors = new Set((returnRequest.vendorIds || []).map((id) => String(id)));
  if (vendors.size > 1) {
    return "This return has items from more than one seller. An exchange comes from one seller only, so open a return per seller.";
  }
  if (String(returnRequest.refundPayer || "") === "vendor") {
    return "The seller collected this order's money, so the seller refunds it; it can't be exchanged here.";
  }
  if (positive(order.customs?.dutyAmount) > 0) {
    return "This order paid import duty, so it can't be exchanged. Refund the return and place a new order instead.";
  }
  const orderCurrency = String(order.currency || params.storeCurrency).toUpperCase();
  if (orderCurrency !== String(params.storeCurrency).toUpperCase()) {
    return `This order was paid in ${orderCurrency}, and new orders are made in ${String(params.storeCurrency).toUpperCase()}, so it can't be exchanged.`;
  }
  return null;
}

type ExchangeProductShape = {
  status?: string | null;
  priceOnRequest?: boolean | null;
  shipping?: { isPhysicalProduct?: boolean } | null;
  preorder?: { enabled?: boolean | null } | null;
  variants?: ReadonlyArray<unknown> | null;
};

/**
 * Why this product cannot go out as an exchange, or null when it can: what is
 * for sale, sent as a parcel, at a price, and on the shelf now — no pre-order,
 * no download, nothing priced on request.
 */
export function exchangeProductProblem(params: {
  product: ExchangeProductShape | null | undefined;
  variant?: { preorder?: { enabled?: boolean | null } | null } | null;
  /** Whether a variant was asked for. */
  variantChosen: boolean;
}): string | null {
  const { product, variant } = params;
  if (!product) return "This product no longer exists.";
  if (String(product.status || "") !== "active") {
    return "This product isn't for sale.";
  }
  if (isDigitalProduct(product)) {
    return "Digital products can't be sent as an exchange.";
  }
  if (isQuoteOnlyProduct(product)) {
    return "Products priced on request can't be sent as an exchange.";
  }
  if (product.preorder?.enabled || variant?.preorder?.enabled) {
    return "Pre-order products can't be sent as an exchange.";
  }
  if ((product.variants || []).length > 0 && !params.variantChosen) {
    return "Choose which variant to send.";
  }
  return null;
}

type ExchangeOverview = {
  currency: string;
  price: ExchangePrice;
  /** What the return is worth, and what of it has gone back already. */
  returnValue: number;
  refunded: number;
  returnLeft: number;
  split: ExchangeSplit;
  /** The goods are back, or never had to come. */
  ready: boolean;
  /**
   * What stops the return being exchanged now, whatever is chosen — see
   * `exchangeItemsProblem` for the items' own.
   */
  blocker: string | null;
  /** Why the exchange can't be processed now, or null when it can. */
  problem: string | null;
};

/** What is wrong with the items chosen, or null — the dialog asks it as they change. */
export function exchangeItemsProblem(lines: ReadonlyArray<ExchangeLine>, total: number): string | null {
  if (lines.length === 0) return "Choose what to send in exchange.";
  if (!(total > 0)) {
    return "The items to send cost nothing, so the return has nothing to pay for. Refund the return and send them as a new order.";
  }
  return null;
}

/**
 * Where an exchange stands before it is processed: what the exchange order
 * will cost, what the return pays of it, and anything in the way.
 */
export function exchangeOverview(params: {
  returnRequest: Parameters<typeof exchangeReturnProblem>[0]["returnRequest"] &
    Parameters<typeof exchangeReadyToProcess>[0] & {
      exchangeItems?: ReadonlyArray<ExchangeLine> | null;
      exchangeDelivery?: number | null;
      estimatedRefund?: { total?: number | null } | null;
      actualRefund?: { amount?: number | null } | null;
    };
  order: Parameters<typeof exchangeReturnProblem>[0]["order"] &
    Parameters<typeof exchangeTaxRate>[0] & { paymentStatus?: string | null };
  storeCurrency: string;
  /** The store's tax rate now, as a percentage, for an order that says none. */
  fallbackTaxPercent: number;
}): ExchangeOverview {
  const { returnRequest, order } = params;
  const currency = String(order.currency || params.storeCurrency || "USD").toUpperCase();
  const price = priceExchange({
    lines: returnRequest.exchangeItems || [],
    taxRate: exchangeTaxRate(order, params.fallbackTaxPercent),
    delivery: returnRequest.exchangeDelivery,
    currency,
  });
  const returnValue = quantizeToCurrency(positive(returnRequest.estimatedRefund?.total), currency);
  const refunded = quantizeToCurrency(positive(returnRequest.actualRefund?.amount), currency);
  const returnLeft = quantizeToCurrency(Math.max(0, returnValue - refunded), currency);
  const split = exchangeSplit({ returnLeft, total: price.total, currency });
  const ready = exchangeReadyToProcess(returnRequest);
  const payment = String(order.paymentStatus || "");
  const blocker =
    exchangeReturnProblem({ returnRequest, order, storeCurrency: params.storeCurrency }) ??
    (payment !== "paid" && payment !== "partially_refunded"
      ? "This order's payment hasn't all been collected, so its return can't pay for an exchange yet."
      : !ready
        ? "Process the exchange once the items are back — record what arrived, or choose that nothing needs sending."
        : !(returnLeft > 0)
          ? "Nothing is left of this return to put towards an exchange."
          : null);
  const problem = blocker ?? exchangeItemsProblem(returnRequest.exchangeItems || [], price.total);
  return { currency, price, returnValue, refunded, returnLeft, split, ready, blocker, problem };
}
