import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";

/**
 * Whether an order's money has arrived — asked per vendor, not per order.
 *
 * On a split order each vendor's consignment is settled separately: one hands
 * their parcel over for cash while another is still waiting to ship. The order
 * document carries a single `paymentStatus`, so before this module a vendor
 * marking their own collection turned into a claim about everybody's:
 *
 *   - `lib/shipping/carriers/build-request.ts` stopped flagging COD, so the
 *     courier delivered the sibling's parcel without collecting anything;
 *   - `lib/order-digital-downloads.ts` unlocked every vendor's files;
 *   - `lib/vendor-earnings.ts` made the sibling's sub-order payable, and
 *     raised a commission debt against a vendor who was holding no cash.
 *
 * Deliberately free of `server-only` and of any import beyond the config
 * enums, exactly as `lib/payment-custody.ts` is: the rule is asserted in tests
 * and needed by both plain object checks and Mongo queries.
 */

type PaymentStatusValue =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/**
 * The states that mean "this money arrived and is still here".
 *
 * `partially_refunded` counts: the payment landed, and part of it going back
 * does not undo the collection. `refunded` does not — that money is gone.
 */
const SETTLED_STATUSES: string[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

/** Order-level states that can contain a settled sub-order. */
export const SETTLED_ORDER_PAYMENT_STATUSES: string[] = [
  PAYMENT_STATUS.PAID,
  // A split order with one vendor collected sits here, and its collected
  // sub-order is every bit as payable as one on a fully paid order.
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

/**
 * Mongo match for a settled sub-order, tolerant of rows the backfill has not
 * reached.
 *
 * `null` inside `$in` also matches a MISSING field, which is what makes this
 * safe to ship ahead of `scripts/backfill-suborder-payment-status.ts`: an
 * un-backfilled sub-order falls back to the order-level arm the caller pairs
 * this with, exactly as {@link resolveSubOrderPaymentStatus} does in JS.
 */
export const SETTLED_SUB_ORDER_PAYMENT_MATCH = {
  $in: [...SETTLED_STATUSES, null],
} as const;

/**
 * Match orders whose sub-order described by `elemMatch` sits in one of
 * `statuses`, including rows the backfill has not reached.
 *
 * The second arm is the fallback expressed in query form: a consignment with
 * no payment field of its own inherits the order's, and no `$elemMatch` can
 * see the order-level field from inside itself.
 *
 * Owns the `$or` key of whatever it is spread into, so callers push it as its
 * own `$and` entry rather than merging it into a filter that has one already.
 */
export function subOrderPaymentStatusFilter(
  elemMatch: Record<string, unknown>,
  statuses: string[],
): Record<string, unknown> {
  return {
    $or: [
      {
        subOrders: {
          $elemMatch: { ...elemMatch, paymentStatus: { $in: statuses } },
        },
      },
      {
        paymentStatus: { $in: statuses },
        subOrders: {
          $elemMatch: { ...elemMatch, paymentStatus: { $exists: false } },
        },
      },
    ],
  };
}

export type SubOrderPaymentShape = {
  status?: string;
  paymentStatus?: string | null;
};

type OrderPaymentShape = {
  paymentStatus?: string;
  subOrders?: SubOrderPaymentShape[] | null;
};

/**
 * This vendor's payment state, falling back to the order's.
 *
 * The fallback is the whole compatibility story: every order written before
 * the split has no sub-order value, and inheriting the order-level one
 * reproduces the old behaviour exactly. New writes set the field, and the
 * fallback stops mattering.
 */
export function resolveSubOrderPaymentStatus(
  order: OrderPaymentShape,
  subOrder: SubOrderPaymentShape | undefined | null,
): string {
  const own = String(subOrder?.paymentStatus || "").trim();
  if (own) return own;
  return String(order.paymentStatus || PAYMENT_STATUS.PENDING);
}

/** Has THIS vendor's share been collected? */
export function isSubOrderPaid(
  order: OrderPaymentShape,
  subOrder: SubOrderPaymentShape | undefined | null,
): boolean {
  return SETTLED_STATUSES.includes(resolveSubOrderPaymentStatus(order, subOrder));
}

/**
 * The order-level payment status implied by its sub-orders.
 *
 * Summary, never authority — the sub-orders are where collection is recorded,
 * and this only keeps the roll-up honest for the many readers (lists, badges,
 * revenue stats) that ask about the order as a whole.
 *
 * Two rules earn their keep:
 *
 *  - a refund is an order-level event in this codebase, so `refunded` and
 *    `partially_refunded` are returned untouched rather than being recomputed
 *    from sub-orders that know nothing about it;
 *  - with nothing collected the current value is returned unchanged rather
 *    than forced to `pending`, because a captured pre-order deposit is a real
 *    `partially_paid` that no sub-order claims and that must not be erased.
 */
export function deriveOrderPaymentStatus(
  order: OrderPaymentShape,
): PaymentStatusValue {
  const current = String(
    order.paymentStatus || PAYMENT_STATUS.PENDING,
  ) as PaymentStatusValue;

  if (
    current === PAYMENT_STATUS.REFUNDED ||
    current === PAYMENT_STATUS.PARTIALLY_REFUNDED
  ) {
    return current;
  }

  const subOrders = order.subOrders || [];
  // A cancelled consignment is owed nothing, so it must not hold the order
  // short of "paid" forever.
  const live = subOrders.filter(
    (subOrder) => subOrder?.status !== ORDER_STATUS.CANCELLED,
  );
  if (live.length === 0) return current;

  const collected = live.filter((subOrder) =>
    isSubOrderPaid(order, subOrder),
  ).length;

  if (collected === live.length) return PAYMENT_STATUS.PAID;
  if (collected > 0) return PAYMENT_STATUS.PARTIALLY_PAID;
  return current;
}

type PreorderBalanceShape = {
  status?: string;
  paymentStatus?: string;
  preorderOutstandingAmount?: number | null;
  /** Clamps the answer — see below. */
  total?: number | null;
};

/**
 * What the shopper still owes on a deposit-mode (or pay-later) pre-order.
 *
 * `preorderOutstandingAmount` is the record of what was agreed at checkout
 * and is never cleared — the ledger relies on that (see `decomposeOrder` in
 * `lib/finance/postings.ts`). So the figure alone cannot say whether the money
 * has arrived; that is the order's payment state. Before this helper every
 * "ready" transition read the raw figure, so a pre-order whose balance the
 * admin had already recorded as paid went straight back to `payment_due` and
 * could never be released for fulfilment.
 *
 * Zero once the order reads paid (or any refund state) and on a cancelled
 * order, which is owed nothing.
 *
 * Clamped to `order.total`, because the stored figure can legitimately exceed
 * it: the outstanding amounts are summed from UNDISCOUNTED line totals while
 * `total` is charged after an order-level coupon. A pay-later pre-order for
 * 100 with a 10-off coupon carries an outstanding of 100 on a total of 90, and
 * an unclamped answer would ask the shopper for 10 more than the order is
 * worth. `decomposeOrder` and `buildChargePayload` clamp the same way.
 */
export function getPreorderBalanceDue(order: PreorderBalanceShape): number {
  const outstanding = Number(order.preorderOutstandingAmount || 0);
  if (!Number.isFinite(outstanding) || outstanding <= 0) return 0;
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) return 0;
  const paymentStatus = String(order.paymentStatus || PAYMENT_STATUS.PENDING);
  if (
    paymentStatus !== PAYMENT_STATUS.PENDING &&
    paymentStatus !== PAYMENT_STATUS.PARTIALLY_PAID
  ) {
    return 0;
  }
  const total = Number(order.total);
  if (Number.isFinite(total) && total > 0) return Math.min(outstanding, total);
  return outstanding;
}
