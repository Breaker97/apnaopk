import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
// The one allowlist of methods whose money a gateway holds. Imported rather
// than restated so a new gateway is added in a single place; the module it
// comes from is as import-light and as `server-only`-free as this one.
import { PLATFORM_GATEWAY_PAYMENT_METHODS } from "@/lib/payments/payment-custody";
import { ASYNC_PUSH_PAYMENT_METHODS } from "@/lib/orders/pending-payment-lock";

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
export const SETTLED_PAYMENT_STATUSES: string[] = [
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
  $in: [...SETTLED_PAYMENT_STATUSES, null],
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

/**
 * The rows in `orders` that are not orders at all: a checkout that reached a
 * gateway and stopped there.
 *
 * Every redirect and mobile-money path writes the whole Order document before
 * the shopper leaves for PayPal, Razorpay, Paystack, Pesapal or their phone's
 * MoMo prompt, and most shoppers who abandon one never come back. Nothing
 * tidies those rows away, so they sat in the same lists and the same sums as
 * real sales: the dashboard counted them as orders, the revenue chart added
 * their totals, and the shopper saw a "Pending" order they never placed.
 *
 * Cash on delivery is deliberately NOT here even though it is also unpaid: the
 * shopper committed to it at checkout and somebody is going to deliver it. The
 * same goes for a pay-later pre-order.
 *
 * **Nor is a mobile-money push.** A shopper at a redirect gateway who closes
 * the tab has decided nothing; a shopper whose phone is showing a MoMo PIN
 * prompt is in the middle of paying, and that order is real while they do it —
 * they can open their order history and see it, and the store can see it
 * coming. So an async-push order is an abandoned attempt only once the
 * provider has actually said no, which is what `expired` means. Until then it
 * reads like any unpaid order, held against edits by
 * `lib/orders/pending-payment-lock.ts`, exactly as Shopify holds a pending
 * payment.
 *
 * `expired` joins `pending` for the redirect gateways because the expiry job
 * only renames the same fact there: the gateway confirmed the money never
 * arrived.
 *
 * An unrecognised payment method reads as a real order, the safe direction
 * here — a row wrongly shown is complained about, a row wrongly hidden is not.
 */
const REDIRECT_GATEWAY_PAYMENT_METHODS = (
  PLATFORM_GATEWAY_PAYMENT_METHODS as readonly string[]
).filter(
  (method) =>
    !(ASYNC_PUSH_PAYMENT_METHODS as readonly string[]).includes(method),
);

const ABANDONED_GATEWAY_ORDER_MATCH: Record<string, unknown> = {
  $or: [
    {
      paymentMethod: { $in: REDIRECT_GATEWAY_PAYMENT_METHODS },
      paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.EXPIRED] },
    },
    {
      paymentMethod: { $in: [...ASYNC_PUSH_PAYMENT_METHODS] },
      paymentStatus: PAYMENT_STATUS.EXPIRED,
    },
  ],
};

/**
 * Mongo match for an order somebody actually placed — everything except the
 * abandoned gateway attempts above. Cancelled orders are included: a person
 * placed them and then called them off, which is a fact the store wants to see.
 *
 * Owns the `$nor` key of whatever it is spread into.
 *
 * ```ts
 * const filter = { ...scopeFilter, ...placedOrderMatch() };
 * ```
 */
export function placedOrderMatch(): Record<string, unknown> {
  return { $nor: [ABANDONED_GATEWAY_ORDER_MATCH] };
}

/**
 * Count money actually collected: unpaid pending orders inflated totals (10
 * abandoned COD checkouts looked like real revenue), while paid gateway orders
 * were the ones that mattered. COD orders count once delivered even if payment
 * is still marked pending.
 *
 * Moved here from `lib/customers/customer.ts`, where it fixed this exact bug
 * for one surface in 2026, while the admin dashboard, the analytics page and
 * the order stats strip went on matching `status != cancelled` and reporting
 * abandoned checkouts as revenue. One definition, so the next surface that
 * needs it cannot invent a fourth answer.
 *
 * `partially_paid` counts because a captured pre-order deposit IS money in the
 * account; `refunded` counts because it arrived before it went back, and the
 * refund is subtracted by whoever nets it, not by hiding the sale.
 *
 * The `delivered` arm is now mostly history. A delivered COD order settles
 * itself — `lib/orders/cod-collection.ts` marks it paid at the delivery, which
 * is what finally put those sales in the ledger too — so new ones arrive here
 * through the payment-status arm like everything else. The arm stays for the
 * rows delivered before that, which would otherwise drop out of the dashboard
 * they have always been counted in.
 */
export const COLLECTED_ORDER_MATCH: Record<string, unknown> = {
  status: { $ne: ORDER_STATUS.CANCELLED },
  $or: [
    {
      paymentStatus: {
        $in: [
          PAYMENT_STATUS.PAID,
          PAYMENT_STATUS.PARTIALLY_PAID,
          PAYMENT_STATUS.PARTIALLY_REFUNDED,
          PAYMENT_STATUS.REFUNDED,
        ],
      },
    },
    { status: ORDER_STATUS.DELIVERED },
  ],
};

/** {@link COLLECTED_ORDER_MATCH} as an aggregation expression. */
export function collectedOrderExpr(): Record<string, unknown> {
  return {
    $and: [
      { $ne: ["$status", ORDER_STATUS.CANCELLED] },
      {
        $or: [
          {
            $in: [
              "$paymentStatus",
              [
                PAYMENT_STATUS.PAID,
                PAYMENT_STATUS.PARTIALLY_PAID,
                PAYMENT_STATUS.PARTIALLY_REFUNDED,
                PAYMENT_STATUS.REFUNDED,
              ],
            ],
          },
          { $eq: ["$status", ORDER_STATUS.DELIVERED] },
        ],
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

/**
 * The payment state a vendor is shown for their own consignment.
 *
 * Its own collection state, not the order's: on a split order the order-level
 * badge read "Partially paid" to a vendor whose share had already arrived. A
 * refund is the exception — it is recorded only on the order, so the
 * consignment never learns of it and would go on reading "Paid".
 */
export function resolveVendorPaymentDisplayStatus(
  order: OrderPaymentShape,
  subOrder: SubOrderPaymentShape | undefined | null,
): string {
  const orderStatus = String(order.paymentStatus || "");
  if (
    orderStatus === PAYMENT_STATUS.REFUNDED ||
    orderStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED
  ) {
    return orderStatus;
  }
  return resolveSubOrderPaymentStatus(order, subOrder);
}

/** Has THIS vendor's share been collected? */
export function isSubOrderPaid(
  order: OrderPaymentShape,
  subOrder: SubOrderPaymentShape | undefined | null,
): boolean {
  return SETTLED_PAYMENT_STATUSES.includes(
    resolveSubOrderPaymentStatus(order, subOrder),
  );
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
  /**
   * Tells a pay-later order, which owes its balance while still `pending`,
   * from a deposit order whose deposit has not arrived yet, which does not.
   * Optional so a projection that leaves it out keeps its old answer — every
   * path that actually takes the balance reads the whole order.
   */
  paymentMethod?: string | null;
  preorderOutstandingAmount?: number | null;
  /** Clamps the answer — see below. */
  total?: number | null;
  /**
   * Consignments, when the caller has them. Optional because most callers
   * project a handful of fields; absent, the answer is what it has always
   * been. See {@link getCancelledConsignmentOutstanding}.
   */
  subOrders?: Array<{
    status?: string;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

/**
 * The part of the recorded balance that belongs to consignments nobody is
 * sending any more.
 *
 * On a split pre-order each vendor can cancel their own consignment, and the
 * shopper was still asked for the whole balance afterwards — money for goods
 * that had already been called off.
 *
 * Computed, never stored, and that is the whole design. The stored
 * `preorderOutstandingAmount` is the record of what was AGREED at checkout,
 * and `lib/finance/postings.ts` sizes the customer receivable from it: reducing
 * the figure would leave a receivable raised at deposit time that could never
 * be taken off again, with the sale and the refund reading different numbers
 * for the same order. So the cancellation is subtracted at the point the
 * question "what does the shopper still owe" is asked, and the books keep the
 * figure they were written against.
 *
 * Read off the sub-order's own items rather than allocated proportionally,
 * because that is how the order-level figure was built in the first place —
 * `buildVendorSubOrders` copies each line's `preorderOutstandingAmount` across
 * — so the parts add back up exactly even when two products carry different
 * deposit terms. A standard line has no such field and contributes nothing.
 */
function getCancelledConsignmentOutstanding(
  order: Pick<PreorderBalanceShape, "subOrders">,
): number {
  const cancelled = (order.subOrders || []).filter(
    (subOrder) => subOrder?.status === ORDER_STATUS.CANCELLED,
  );
  let total = 0;
  for (const subOrder of cancelled) {
    for (const item of subOrder.items || []) {
      const amount = Number(item?.preorderOutstandingAmount || 0);
      if (Number.isFinite(amount) && amount > 0) total += amount;
    }
  }
  return total;
}

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
 *
 * Net of any consignment that has since been cancelled — see
 * {@link getCancelledConsignmentOutstanding} for why that subtraction happens
 * here rather than on the order document.
 */
/**
 * The day an unpaid pre-order balance runs out of time.
 *
 * The store asks for the balance, waits out a grace period, and then cancels
 * and refunds (`expireUnpaidPreorders`). Until this helper that deadline
 * existed only inside the expiry job's own query: the shopper was told to pay
 * and never told by when, and then had their pre-order cancelled for missing
 * a date nobody had published. This is the one statement of the rule, so the
 * message, the order page and the job cannot drift apart.
 *
 * The clock starts at the LATER of the promised release date and the day the
 * store actually asked — a batch received in July against a June release date
 * would otherwise be past its grace the moment the request went out. Orders
 * placed before `preorderBalanceRequestedAt` existed fall back to the release
 * date, which is the behaviour they have always had.
 *
 * Null when there is no date to count from; a caller with nothing to show says
 * nothing rather than inventing a deadline.
 *
 * A balance requested through a collection cycle counts from the moment its
 * advance notice was ACCEPTED by the mail server, not from when it was asked
 * for: a request the shopper was never told about has no deadline at all
 * (`lib/orders/preorder-collection.ts`), and repeated reminders never move it.
 * Requests from before cycles existed keep the request date, as they always
 * have.
 */
export function getPreorderBalanceDeadline(
  order: {
    preorderReleaseDate?: Date | string | null;
    preorderBalanceRequestedAt?: Date | string | null;
    preorderCollection?: {
      cycleId?: string | null;
      notice?: { acceptedAt?: Date | string | null } | null;
    } | null;
  },
  graceDays: number,
): Date | null {
  const cycle = order.preorderCollection;
  const requestBase = cycle?.cycleId
    ? cycle.notice?.acceptedAt
    : order.preorderBalanceRequestedAt;
  // No accepted notice, no clock.
  if (cycle?.cycleId && !requestBase) return null;
  const times = [order.preorderReleaseDate, requestBase]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  const days = Number(graceDays);
  return new Date(
    Math.max(...times) +
      (Number.isFinite(days) && days > 0 ? days : 0) * 24 * 60 * 60 * 1000,
  );
}

export function getPreorderBalanceDue(order: PreorderBalanceShape): number {
  const outstanding =
    Number(order.preorderOutstandingAmount || 0) -
    getCancelledConsignmentOutstanding(order);
  if (!Number.isFinite(outstanding) || outstanding <= 0) return 0;
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) return 0;
  const paymentStatus = String(order.paymentStatus || PAYMENT_STATUS.PENDING);
  if (
    paymentStatus !== PAYMENT_STATUS.PENDING &&
    paymentStatus !== PAYMENT_STATUS.PARTIALLY_PAID
  ) {
    return 0;
  }
  // `pending` owes a balance only on a pay-later order, whose checkout took
  // nothing. A deposit order also sits on `pending` until its gateway captures
  // the deposit, and asking it for the balance first let the shopper pay the
  // balance alone: the order read paid, and the deposit was never taken.
  if (
    paymentStatus === PAYMENT_STATUS.PENDING &&
    order.paymentMethod != null &&
    order.paymentMethod !== PAY_LATER_PAYMENT_METHOD
  ) {
    return 0;
  }
  const total = Number(order.total);
  if (Number.isFinite(total) && total > 0) return Math.min(outstanding, total);
  return outstanding;
}

/** The method a pre-order carries when nothing at all was due at checkout. */
export const PAY_LATER_PAYMENT_METHOD = "pay_later";

/**
 * Mongo mirror of the payment half of {@link getPreorderBalanceDue}: part-paid,
 * or pending on a pay-later order. Wrapped in `$and` so it can be spread into a
 * filter that carries its own `$or`.
 */
export function owesPreorderBalanceMatch(): Record<string, unknown> {
  return {
    $and: [
      {
        $or: [
          { paymentStatus: PAYMENT_STATUS.PARTIALLY_PAID },
          {
            paymentStatus: PAYMENT_STATUS.PENDING,
            paymentMethod: PAY_LATER_PAYMENT_METHOD,
          },
        ],
      },
    ],
  };
}

/**
 * What the shopper actually paid on a pre-order.
 *
 * Not the order total: a deposit order collected `total - balance`, and a
 * pay-later one that was never paid collected nothing. Refunding the total
 * would send back money that never arrived.
 *
 * Deliberately NOT built on `getPreorderBalanceDue`, which answers zero for a
 * cancelled order — correct for "how much is still owed", catastrophic here,
 * because this runs immediately AFTER the cancel and would then read the whole
 * total as collected. The signals used instead say nothing about status:
 * `pending` means no capture ever happened, and `preorderBalancePaidAt` is the
 * stamp the balance leaves whether it arrived through a gateway or was
 * recorded by hand.
 *
 * Kept here, free of the refund flow that first needed it, because the
 * invoice prints the same figure.
 */
export function getPreorderCollectedAmount(order: {
  total?: number;
  preorderOutstandingAmount?: number;
  paymentStatus?: string;
  preorderBalancePaidAt?: Date | null;
  preorderBalancePaidAmount?: number | null;
  storeCredit?: { applied?: number | null; state?: string | null } | null;
}): number {
  // Store credit given back before the payment came paid for nothing (R8):
  // only a late payment can make such an order paid, and it brought the rest.
  const releasedCredit =
    order.storeCredit?.state === "released"
      ? Math.max(0, Number(order.storeCredit.applied) || 0)
      : 0;
  const total = Math.max(0, Number(order.total || 0) - releasedCredit);
  if (!(total > 0)) return 0;
  if (String(order.paymentStatus || PAYMENT_STATUS.PENDING) === PAYMENT_STATUS.PENDING) {
    return 0;
  }
  const outstanding = Math.min(
    Math.max(0, Number(order.preorderOutstandingAmount || 0)),
    total,
  );
  if (!order.preorderBalancePaidAt) return Math.max(0, total - outstanding);
  // The balance that actually arrived, where it was recorded. A consignment
  // called off before the balance was charged took its share of the balance
  // with it, so "paid" is not "the whole total".
  const paidAmount = Number(order.preorderBalancePaidAmount);
  if (order.preorderBalancePaidAmount == null || !Number.isFinite(paidAmount)) {
    return total;
  }
  return Math.min(total, Math.max(0, total - outstanding + Math.max(0, paidAmount)));
}

/**
 * What the shopper has paid towards a pre-order and not had back.
 *
 * Not `total - balance`, which is what the order page used to show: once a
 * vendor calls a consignment off, that reads the called-off balance — money
 * that never arrived — as paid, and ignores the deposit refunded with it.
 */
export function getPreorderPaidSoFar(
  order: Parameters<typeof getPreorderCollectedAmount>[0] & {
    refundedTotal?: number | null;
  },
): number {
  const refunded = Math.max(0, Number(order.refundedTotal || 0));
  return Math.max(0, getPreorderCollectedAmount(order) - refunded);
}

/**
 * Whether a live pre-order still has part of its balance to come — read off
 * the order's terms, never off its payment state.
 *
 * `getPreorderBalanceDue` answers from the payment state, which is right for
 * "what do we ask the shopper for", and is exactly why a REFUND must not be
 * what moves that state. Refunding one consignment of a split deposit order
 * wrote it `partially_refunded`, and from then on the other seller's balance
 * read as zero: nobody was asked for it, the card on file was never charged,
 * and "ready" released the goods without it. Every refund writer asks this
 * first and leaves such an order `partially_paid` — a refund gives money back,
 * it does not collect the rest.
 *
 * False once the balance has arrived (`preorderBalancePaidAt`, stamped however
 * it arrived), on a cancelled order, and once every consignment still owing it
 * has been called off.
 */
/**
 * Mongo mirror of {@link hasUncollectedPreorderBalance}: a live pre-order whose
 * balance, net of any consignment since called off, has not arrived. Written to
 * sit inside a `$nor`, so it composes with a filter that carries its own `$or`.
 */
export function uncollectedPreorderBalanceMatch(): Record<string, unknown> {
  const cancelledOutstanding = {
    $sum: {
      $map: {
        input: {
          $filter: {
            input: { $ifNull: ["$subOrders", []] },
            as: "sub",
            cond: { $eq: ["$$sub.status", ORDER_STATUS.CANCELLED] },
          },
        },
        as: "sub",
        in: {
          $sum: {
            $map: {
              input: { $ifNull: ["$$sub.items", []] },
              as: "item",
              in: {
                $max: [0, { $ifNull: ["$$item.preorderOutstandingAmount", 0] }],
              },
            },
          },
        },
      },
    },
  };
  return {
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderBalancePaidAt: null,
    $expr: {
      $gt: [
        {
          $subtract: [
            { $ifNull: ["$preorderOutstandingAmount", 0] },
            cancelledOutstanding,
          ],
        },
        // Half a cent, as the JS rule: float residue is not a balance.
        0.005,
      ],
    },
  };
}

export function hasUncollectedPreorderBalance(
  order: PreorderBalanceShape & {
    preorderBalancePaidAt?: Date | string | null;
  },
): boolean {
  if (order.preorderBalancePaidAt) return false;
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) return false;
  const outstanding =
    Number(order.preorderOutstandingAmount || 0) -
    getCancelledConsignmentOutstanding(order);
  // Half a cent, so float residue from the netting is not a balance.
  return Number.isFinite(outstanding) && outstanding > 0.005;
}
