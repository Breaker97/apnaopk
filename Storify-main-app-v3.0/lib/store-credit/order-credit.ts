import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * Store credit on an order (R8): how much of it the shopper's credit paid, and
 * what that means for the money the gateway took and for refunds.
 *
 * Pure and free of `server-only`, so the checkout page, the order screens, the
 * gateways' amount checks and the ledger all read the same rules.
 *
 * The credit is held while the order's payment is on its way (`held`), spent
 * once it lands (`spent`), and given back if the order never gets paid
 * (`released`) — a released credit paid for nothing, so it no longer counts.
 * `refunded` is the credit given to the shopper on refunds of this order,
 * whether it went back as the credit it came from or as a refund to credit.
 */

export type OrderStoreCredit = {
  applied?: number | null;
  holdKey?: string | null;
  state?: string | null;
  refunded?: number | null;
};

type WithStoreCredit = { storeCredit?: OrderStoreCredit | null };

const positive = (value: unknown) => Math.max(0, Number(value) || 0);

/** What the shopper's credit pays of this order: nothing once it was released. */
export function orderCreditApplied(order: WithStoreCredit | null | undefined): number {
  const credit = order?.storeCredit;
  if (!credit || credit.state === "released") return 0;
  return positive(credit.applied);
}

/**
 * The credit the order's payment was asked for less. Unlike
 * `orderCreditApplied` it stands after a release: every quote for the order
 * — the checkout, its gateway, a pay link — left the credit out, so a payment
 * landing after the hold was given back is still the right amount, and takes
 * the credit again as it lands (`settleOrderStoreCredit`).
 */
export function orderCreditCounted(order: WithStoreCredit | null | undefined): number {
  return positive(order?.storeCredit?.applied);
}

/** Credit given back on this order's refunds so far. */
function orderCreditRefunded(order: WithStoreCredit | null | undefined): number {
  return positive(order?.storeCredit?.refunded);
}

/**
 * How much of what this order still has to refund goes back as credit first:
 * the credit it was paid with, less what has already gone back as credit. The
 * card never took that part, so it cannot give it back.
 */
export function orderCreditRestorable(order: WithStoreCredit | null | undefined): number {
  return Math.max(0, orderCreditApplied(order) - orderCreditRefunded(order));
}

/**
 * How a refund on an order divides between store credit and the way the rest
 * was paid.
 *
 * Credit first (the store's rule, 2026-09-29): the part the shopper paid with
 * credit goes back as credit before any card money does, so goods bought with
 * credit cannot be turned into cash by returning them. `explicitCredit` is the
 * admin's own figure when they chose store credit in the dialog — all of the
 * refund, or less than the credit-first part, which sends more to the card.
 */
export function splitRefundCreditFirst(params: {
  amount: number;
  order: WithStoreCredit | null | undefined;
  currency: string;
  /** Set when the admin named the credit; absent is credit first. */
  explicitCredit?: number | null;
}): { credit: number; gateway: number; restored: number } {
  const currency = params.currency || "USD";
  const amount = quantizeToCurrency(positive(params.amount), currency);
  const restorable = orderCreditRestorable(params.order);
  const named =
    params.explicitCredit === undefined || params.explicitCredit === null
      ? null
      : positive(params.explicitCredit);
  const credit = quantizeToCurrency(
    Math.min(amount, named === null ? restorable : named),
    currency,
  );
  return {
    credit,
    gateway: quantizeToCurrency(amount - credit, currency),
    // The part of the credit that is the order's own credit going back.
    restored: quantizeToCurrency(Math.min(credit, restorable), currency),
  };
}

/**
 * The most the order's own payment — the card, the wallet — can still give
 * back: what it took, less what it has given back already. What it took is
 * the collected amount less the credit that paid the rest.
 */
export function orderGatewayRefundRoom(params: {
  order: WithStoreCredit & { refundedTotal?: number | null };
  /** What the order collected — see `getOrderRefundCeiling`. */
  collected: number;
  currency: string;
}): number {
  const applied = orderCreditApplied(params.order);
  if (!(applied > 0)) return Number.POSITIVE_INFINITY;
  const gatewayTook = Math.max(0, positive(params.collected) - applied);
  const gatewayGaveBack = Math.max(
    0,
    positive(params.order.refundedTotal) - orderCreditRefunded(params.order),
  );
  return quantizeToCurrency(Math.max(0, gatewayTook - gatewayGaveBack), params.currency);
}
