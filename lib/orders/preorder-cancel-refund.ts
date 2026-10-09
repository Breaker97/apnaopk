import { Order, PaymentTransaction } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import type { AuditContext } from "@/lib/audit";
import {
  RefundOutcomeUnknownError,
  refundOrderPayment,
} from "@/lib/orders/order-refund";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import { settleRefundedPaymentStatus } from "@/lib/orders/refund-payment-status";
import { quantizeToCurrency } from "@/lib/intl/money";
import {
  consignmentCharge,
  isConsignmentCollected,
  type PostingOrder,
} from "@/lib/finance/postings";
import {
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";
import {
  getPreorderCollectedAmount,
  hasUncollectedPreorderBalance,
} from "@/lib/orders/order-payment-status";
import {
  orderCreditApplied,
  splitRefundCreditFirst,
  type OrderStoreCredit,
} from "@/lib/store-credit/order-credit";
import { isActiveExchangeOrder } from "@/lib/returns/exchange";

/** The return an exchange order was made for (R7) — see lib/returns/exchange.ts. */
type ExchangeOrderFields = {
  exchangeOf?: { returnId?: unknown; returnNumber?: string; undoneAt?: Date | null } | null;
};

/**
 * Give a cancelled pre-order's money back.
 *
 * Cancelling a pre-order used to move the status, restore the stock, release
 * the quota and reverse the coupon — and leave the shopper's deposit sitting in
 * the platform's account with nothing in the UI saying so. An admin could still
 * refund it from the general order screen, but the pre-order screen's own
 * Cancel button neither did it nor mentioned it. This closes that.
 *
 * The policy is deliberate and absolute: **cancel means refund**, whoever
 * cancels — vendor, admin, or the auto-expiry job. There is therefore no
 * `depositRefundable` setting to consult, no per-campaign policy, and no
 * reason-code branching, which is also why a non-refundable deposit cannot be
 * configured by accident in a jurisdiction that forbids it.
 *
 * ---
 *
 * KNOWN DUPLICATION. This is the third hand-rolled refund orchestration in the
 * codebase, alongside `app/api/admin/orders/[id]` and
 * `app/api/admin/returns/[id]`. All three claim refund headroom the same way,
 * call the same gateway helper and write the same transaction row, and all
 * three will drift. Extracting one shared flow was weighed and deferred
 * deliberately: it would mean reworking two live, money-critical routes at the
 * same time as adding this one. When a fourth caller appears — or when any of
 * these three needs a real change — extract `lib/orders/order-refund-flow.ts`
 * and route all of them through it, rather than adding a fourth copy here.
 */

type CancelRefundOutcome = {
  refunded: boolean;
  amount?: number;
  currency?: string;
  /** Present when nothing was refunded — why, in words an admin can act on. */
  reason?: string;
  /** False when the money has to be sent back by hand. */
  gatewayCalled?: boolean;
  /**
   * Money the shopper is owed did not go back: the gateway refused it, or
   * another refund took the headroom first. Absent when there was simply
   * nothing to send — nothing collected, already refunded — so a screen warns
   * only when somebody has to act.
   */
  failed?: boolean;
  /**
   * The gateway's answer was lost: the refund may or may not have been made.
   * Never retried blind — see `RefundOutcomeUnknownError`.
   */
  outcomeUnknown?: boolean;
};

/**
 * Tell admins a cancelled order's money did not go back.
 *
 * The cancellation stands either way, so the outcome handed to the caller was
 * the only record of the money still owed — and most callers showed "Order
 * cancelled" and moved on: the shopper's own cancel, a vendor's, the admin
 * order screen, the expiry job. The order sat cancelled and paid with no
 * refund row, and nobody knew to send it.
 */
export async function reportFailedCancelRefund(params: {
  order: { _id: unknown; orderNumber?: string };
  /** Unknown when the refund failed before it could be priced. */
  amount?: number;
  currency?: string;
  why: string;
}) {
  const { notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  const owed =
    typeof params.amount === "number"
      ? `${params.amount} ${params.currency || ""}`.trim() + " "
      : "";
  await notifyAdminsPaymentAnomaly({
    title: "A cancelled order's refund did not go through",
    message: `Order #${params.order.orderNumber || String(params.order._id)} was cancelled, but its ${owed}refund was not sent: ${params.why}. Check the order's refunds and send the shopper what they are still owed — refund the order again from its page, or return the money by hand.`,
    link: `/admin/orders/${String(params.order._id)}`,
  }).catch((err) =>
    console.error("Failed to report a cancellation refund that did not go through:", err),
  );
}

type RefundableOrder = {
  _id: unknown;
  orderNumber: string;
  total?: number;
  refundedTotal?: number;
  currency?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  preorderBalancePaymentIntentId?: string;
  preorderBalancePaypalOrderId?: string;
  paypalCaptureId?: string;
  paypalOrderId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  posLocationId?: unknown;
  createdAt?: Date;
  status?: string;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  subOrders?: Array<{
    _id?: unknown;
    status?: string;
    paymentStatus?: string | null;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
  customerId?: unknown;
  /** Store credit that paid part of the order (R8) — see order-credit.ts. */
  storeCredit?: OrderStoreCredit | null;
};

/**
 * What the shopper paid towards ONE consignment of a split pre-order.
 *
 * A vendor cancelling their own consignment leaves the rest of the order
 * standing, so the whole collected amount is the wrong thing to send back —
 * the shopper is still receiving (and still paying for) everybody else's
 * goods.
 *
 * The charge comes from `consignmentCharge`, which is the same decomposition
 * the sale and the refund post against, so this cannot drift from the ledger
 * the way a hand-rolled `subtotal + shippingCost` would: that pair is
 * undiscounted and carries no tax, and refunding it would hand back more than
 * the consignment ever brought in on any couponed order.
 *
 * The balance is subtracted the way {@link getPreorderCollectedAmount} does it,
 * off the consignment's OWN lines rather than a proportional share, because
 * that is how the order-level figure was summed in the first place.
 */
export function getSubOrderPreorderCollectedAmount(
  order: Parameters<typeof consignmentCharge>[0] & {
    paymentStatus?: string;
    preorderBalancePaidAt?: Date | null;
  },
  subOrder: {
    _id?: unknown;
    paymentStatus?: string | null;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  },
): number {
  if (
    String(order.paymentStatus || PAYMENT_STATUS.PENDING) === PAYMENT_STATUS.PENDING
  ) {
    return 0;
  }
  // THIS consignment's money, the way the ledger asks it. On a split cash
  // order the order reads part-paid the moment one parcel is paid for at the
  // door, and reading that as "collected" wrote a refund for cash that nobody
  // had handed over for the parcel being called off.
  if (
    !isConsignmentCollected({ ...order, _id: undefined } as PostingOrder, {
      paymentStatus: subOrder.paymentStatus,
    })
  ) {
    return 0;
  }
  const charge = consignmentCharge(order, subOrder._id);
  if (!charge || !(charge.total > 0)) return 0;

  const outstanding = (subOrder.items || []).reduce((sum, item) => {
    const amount = Number(item?.preorderOutstandingAmount || 0);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  const neverArrived = order.preorderBalancePaidAt
    ? 0
    : Math.min(outstanding, charge.total);
  return Math.max(0, Number((charge.total - neverArrived).toFixed(2)));
}

/**
 * What the order as a whole has collected, consignment by consignment.
 *
 * A pre-order's deposit arrives for the whole order at once, so its figure
 * stays the order-level one. A split order paid at the door does not: one
 * parcel can be paid for while another is still out, and counting the order
 * total as collected let a cancellation of the unpaid one hand back cash that
 * never arrived. Summed from the same per-consignment answer the refund of any
 * one of them uses, so the two can never disagree.
 */
function getOrderCollectedAmount(
  order: RefundableOrder & { currency: string },
): number {
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (Number(order.preorderOutstandingAmount || 0) > 0 || subOrders.length < 2) {
    return getPreorderCollectedAmount(order);
  }
  const priced = order as Parameters<typeof getSubOrderPreorderCollectedAmount>[0];
  if (!consignmentCharge(priced, subOrders[0]?._id)) {
    return getPreorderCollectedAmount(order);
  }
  // Store credit given back before the money came paid for nothing — see
  // `getPreorderCollectedAmount`.
  const releasedCredit =
    order.storeCredit?.state === "released"
      ? Math.max(0, Number(order.storeCredit.applied) || 0)
      : 0;
  return Number(
    Math.max(
      0,
      subOrders.reduce(
        (sum, sub) => sum + getSubOrderPreorderCollectedAmount(priced, sub),
        0,
      ) - releasedCredit,
    ).toFixed(2),
  );
}

/**
 * The most a refund on this order may ever reach: what it collected.
 *
 * The order total, except where money never arrived for part of it — a
 * pre-order's unpaid balance, or a split cash order's consignment called off
 * before anybody paid for it at the door. That consignment refunds nothing
 * when it is cancelled, and the total never comes down, so its value stayed
 * "refundable" for good: a Full refund on the order screen asked the store to
 * send back money the shopper had never handed over, and the ledger took the
 * excess off the cancelled seller. Collected sums the consignments' charges,
 * which add up to the total exactly, so an order whose money all arrived is
 * held to its total as before.
 */
export function getOrderRefundCeiling(
  order: RefundableOrder & { currency: string },
): number {
  const total = Number(order.total || 0);
  const collected = getOrderCollectedAmount(order);
  return collected > 0 ? Math.min(total, collected) : total;
}

export async function refundCancelledPreorder(params: {
  orderId: string;
  reason?: string;
  /** Recorded in the gateway's own audit trail. */
  actor?: string;
  /** User id stamped on the transaction row. */
  createdBy?: string;
  auditContext?: AuditContext;
  /**
   * Send back only this much of what the shopper paid — one cancelled
   * consignment's share, from
   * {@link getSubOrderPreorderCollectedAmount}. Omitted means everything
   * collected, which is what cancelling the whole order gives back.
   *
   * Clamped to what the order actually took, so a caller's arithmetic can
   * never refund more than arrived.
   */
  collected?: number;
  /** Announce a refund someone must send by hand; off where the caller already does. */
  notifySettlement?: boolean;
  /**
   * Tell admins when money owed could not be sent back. Off only where the
   * caller raises its own alert with the outcome in it.
   */
  reportFailure?: boolean;
  /**
   * The consignments `collected` belongs to. Recorded with the refund, so the
   * ledger and the payouts take it back from those sellers alone instead of
   * spreading one seller's cancellation over everybody on the order.
   */
  consignmentIds?: ReadonlyArray<unknown>;
  /**
   * The durable operation this refund belongs to, recorded on the refund row
   * and the gateway refund, so a run resumed after a crash can find what an
   * earlier run made — see `lib/orders/preorder-operations.ts`.
   */
  operationId?: string;
  /** Stable per refund attempt; makes a gateway replay return the same refund. */
  idempotencyKey?: string;
}): Promise<CancelRefundOutcome> {
  const order = (await Order.findById(
    params.orderId,
  ).lean()) as RefundableOrder | null;
  if (!order) return { refunded: false, reason: "Order not found" };

  // Whatever happens to the refund below, a balance that will now never be
  // asked for comes off the books — see `balanceWriteOffPostings`. Written
  // once per called-off consignment, however many times this runs.
  await import("@/lib/finance/post-events")
    .then(({ postBalanceWriteOffSafely }) => postBalanceWriteOffSafely(order._id))
    .catch((err: unknown) =>
      console.error("Failed to write off a called-off pre-order balance:", err),
    );

  const settings = await getSettings();
  const currency =
    String(order.currency || settings.general?.defaultCurrency || "USD")
      .trim()
      .toUpperCase();

  const total = Number(order.total || 0);

  // What the order took in total, and what THIS cancellation is giving back.
  // They differ only when one consignment of a split order was cancelled; the
  // order-wide figure still decides whether the refund below finishes the job.
  const collectedOnOrder = getOrderCollectedAmount({ ...order, currency });
  if (collectedOnOrder <= 0) {
    return { refunded: false, reason: "No money was collected on this order" };
  }
  const collected =
    params.collected === undefined
      ? collectedOnOrder
      : Math.max(0, Math.min(params.collected, collectedOnOrder));
  if (collected <= 0) {
    return {
      refunded: false,
      reason: "Nothing was collected for the cancelled consignment",
    };
  }

  const [refundSummary] = await PaymentTransaction.aggregate([
    { $match: { orderId: order._id, type: "refund", status: "succeeded" } },
    { $group: { _id: null, totalRefunded: { $sum: "$grossAmount" } } },
  ]);
  const alreadyRefunded = Number(refundSummary?.totalRefunded || 0);
  // What is spoken for already: the refund rows, or the running total when it
  // is ahead of them — a refund still in flight has reserved its share there
  // before its row exists. Sized from the rows alone, a cancel landing beside
  // an admin's partial refund asked for the whole order, was refused at the
  // claim below, and the rest of the money was never sent at all.
  const alreadyClaimed = Math.max(
    alreadyRefunded,
    Number((order as { refundedTotal?: number }).refundedTotal || 0),
  );
  // Never more than is left unrefunded on the order as a whole: two
  // consignments cancelled in turn each ask for their own share, and a stale
  // read must not let the pair exceed what arrived.
  const amount = quantizeToCurrency(
    Math.min(collected, collectedOnOrder - alreadyClaimed),
    currency,
  );
  if (amount <= 0) {
    return { refunded: false, reason: "Already refunded" };
  }
  // Does this hand back the last of the money? Everything below that treats
  // the sale as finished — the payment status, the loyalty reversal, the audit
  // entry — turns on this rather than on the caller's intent. Never while the
  // rest of the order is still waiting on its balance: that sale is not
  // finished, however little of it has been collected so far. Read off the
  // order as it stands after the cancellation, which every caller writes first.
  const balanceStillToCome = hasUncollectedPreorderBalance(order);
  // The same for a split cash order's other parcel, still live and not yet
  // paid for at the door. "Everything collected so far" is not everything:
  // cancelling the one consignment that had been paid for read as the whole
  // order refunded, and when the other parcel's cash came in the order stayed
  // `refunded` — no charge, no points, files closed, and no refund or return
  // possible for goods the shopper had just paid for.
  const cashStillToCome = (order.subOrders || []).some(
    (sub) =>
      sub?.status !== ORDER_STATUS.CANCELLED &&
      !isConsignmentCollected({ ...order, _id: undefined } as PostingOrder, {
        paymentStatus: sub?.paymentStatus,
      }),
  );
  const refundsEverything =
    !balanceStillToCome &&
    !cashStillToCome &&
    alreadyClaimed + amount >= collectedOnOrder - 0.01;

  // Reserve the headroom before any money moves, exactly as the order and
  // return routes do, so a cancel racing a manual refund cannot both pass the
  // cap. The ceiling is what the order COLLECTED, not its `total`: on a deposit
  // order the total sits far above the money that arrived, so two cancels
  // running at once both fitted under it and both sent the deposit back. What
  // was collected never exceeds the total, so the invariant `refundedTotal`
  // carries everywhere still holds.
  // Stamped in the same write, so the gateway's refund webhook waits for the
  // row below instead of recording this refund as one of its own.
  const refundStamp = new Date();
  const claim = await Order.findOneAndUpdate(
    {
      _id: order._id,
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ["$refundedTotal", alreadyRefunded] }, amount] },
          collectedOnOrder + 0.01,
        ],
      },
    },
    [
      {
        $set: {
          refundedTotal: {
            $add: [{ $ifNull: ["$refundedTotal", alreadyRefunded] }, amount],
          },
          refundInFlightAt: refundStamp,
        },
      },
    ],
    { returnDocument: "after" },
  ).lean();
  if (!claim) {
    // Another refund holds the headroom — usually one still in flight — so
    // this share may well still be owed once it lands. Nothing retries it.
    const reason = "Another refund on this order used up the remaining amount";
    if (params.reportFailure !== false) {
      await reportFailedCancelRefund({
        order,
        amount,
        currency,
        why: reason.toLowerCase(),
      });
    }
    return { refunded: false, failed: true, amount, currency, reason };
  }

  // The credit the order was paid with goes back first, as credit (R8); the
  // gateway sends the rest.
  const split = splitRefundCreditFirst({ amount, order, currency });
  const creditPart = split.credit;
  const gatewayPart = split.gateway;
  // Set when the gateway refused its part while the credit part still went.
  let gatewayRefusal: string | null = null;

  let gateway: Awaited<ReturnType<typeof refundOrderPayment>> | undefined;
  try {
    gateway =
      gatewayPart > 0
        ? await refundOrderPayment({
            order: {
              paymentMethod: order.paymentMethod,
              channel: order.channel,
              paymentId: order.paymentId,
              stripePaymentIntentId: order.stripePaymentIntentId,
              preorderBalancePaymentIntentId: order.preorderBalancePaymentIntentId,
              preorderBalancePaypalOrderId: order.preorderBalancePaypalOrderId,
              paypalCaptureId: order.paypalCaptureId,
              paypalOrderId: order.paypalOrderId,
              razorpayPaymentId: order.razorpayPaymentId,
              paystackTransactionId: order.paystackTransactionId,
              pesapalConfirmationCode: order.pesapalConfirmationCode,
              currency,
            },
            amount: gatewayPart,
            reason: params.reason || "Pre-order cancelled",
            actor: params.actor,
            idempotencyKey: params.idempotencyKey,
            gatewayMetadata: params.operationId
              ? { preorderOperation: params.operationId }
              : undefined,
          })
        : undefined;
  } catch (err) {
    const outcomeUnknown = err instanceof RefundOutcomeUnknownError;
    const refusal =
      err instanceof Error ? err.message : "the gateway refused the refund";
    console.error(
      `Cancellation refund of ${gatewayPart} ${currency} on ${order.orderNumber} failed:`,
      err,
    );
    // Unlike the admin route, a gateway failure here must NOT throw: the
    // cancellation itself has already happened and is not being undone. Give
    // the headroom back and report it, so the caller can tell an admin the
    // money still has to go back by hand instead of a silent success.
    await Order.updateOne(
      { _id: order._id },
      { $inc: { refundedTotal: -gatewayPart } },
    ).catch((rollbackErr) =>
      console.error("Failed to roll back cancel-refund claim:", rollbackErr),
    );
    if (params.reportFailure !== false) {
      await reportFailedCancelRefund({
        order,
        amount: gatewayPart,
        currency,
        why: refusal,
      });
    }
    if (!(creditPart > 0)) {
      await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );
      return {
        refunded: false,
        failed: true,
        ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
        amount,
        currency,
        reason: outcomeUnknown ? refusal : `Refund this order by hand — ${refusal}`,
      };
    }
    // The store credit part never needed the gateway: it still goes back.
    gatewayRefusal = refusal;
  }
  // What goes back now: all of it, or the credit alone when the gateway refused.
  const sent = gatewayRefusal ? creditPart : amount;

  // Everything the shopper paid is on its way back, so the order is refunded
  // in full. The yardstick is what was COLLECTED, not `total`: a deposit order
  // whose balance was never charged would otherwise read `partially_refunded`
  // forever, implying the store still owes something when it does not.
  //
  // One consignment of a split order going back is the other case, and it is
  // genuinely partial — the shopper is still receiving, and still paying for,
  // the rest. While that rest is still waiting on its balance the order stays
  // `partially_paid`: a refund gives money back, it collects nothing, and every
  // balance path reads `partially_refunded` as settled. Written that way, the
  // other seller's balance was never asked for, the card on file was never
  // charged, and "ready" released the goods without it.
  const paymentStatus = balanceStillToCome
    ? PAYMENT_STATUS.PARTIALLY_PAID
    : refundsEverything && !gatewayRefusal
      ? PAYMENT_STATUS.REFUNDED
      : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  // With cash still to come at the door the order already reads part-paid,
  // and whatever it reads — the other parcel may have been paid for this
  // very moment — is the truth a refund has nothing to add to.
  // Part-paid is guarded, because "still to come" was read before the gateway
  // call: a balance that arrived in the meantime has already marked the order
  // paid, and part-paid written over that would ask for the balance again.
  if (!cashStillToCome) {
    await Order.updateOne(
      balanceStillToCome
        ? {
            _id: order._id,
            $or: [
              { preorderBalancePaidAt: null },
              { preorderBalancePaidAt: { $exists: false } },
            ],
          }
        : { _id: order._id },
      { $set: { paymentStatus } },
    );
    // Another refund finishing beside this one may have written its own
    // status over it — see `settleRefundedPaymentStatus`.
    if (!balanceStillToCome) {
      await settleRefundedPaymentStatus({
        orderId: order._id,
        ceiling: collectedOnOrder,
      });
    }
  }

  const refundOrderShape = {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus,
    paymentId: order.paymentId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    paypalCaptureId: order.paypalCaptureId,
    razorpayPaymentId: order.razorpayPaymentId,
    paystackTransactionId: order.paystackTransactionId,
    pesapalConfirmationCode: order.pesapalConfirmationCode,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    tax: order.tax,
    discount: order.discount,
    total,
    currency,
    channel: order.channel || "online",
    posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
    createdAt: order.createdAt,
  };

  // The credit part (R8): its own refund row, and the credit back on the
  // shopper's account. Handed back and reported if it cannot be given.
  // An exchange order's credit is its return's money (R7): called off, it
  // goes back on that return instead, to be refunded or exchanged again.
  let creditGiven = 0;
  const exchangeReturnNumber = isActiveExchangeOrder(order as ExchangeOrderFields)
    ? String((order as ExchangeOrderFields).exchangeOf?.returnNumber || "")
    : null;
  if (creditPart > 0 && exchangeReturnNumber !== null) {
    try {
      const { undoReturnExchange } = await import("@/lib/returns/return-exchange");
      const undone = await undoReturnExchange({
        exchangeOrder: order as Parameters<typeof undoReturnExchange>[0]["exchangeOrder"],
        amount: creditPart,
        paid: true,
        refundOrder: refundOrderShape,
        consignmentIds: params.consignmentIds,
        reason: params.reason,
        createdBy: params.createdBy || "system",
        auditContext: params.auditContext,
      });
      if (!undone.undone) throw new Error("the exchange was already called off");
      creditGiven = creditPart;
    } catch (err) {
      console.error(`The exchange behind ${order.orderNumber} could not be called off:`, err);
      await Order.updateOne(
        { _id: order._id },
        { $inc: { refundedTotal: -creditPart } },
      ).catch((rollbackErr) =>
        console.error("Failed to roll back cancel-refund claim:", rollbackErr),
      );
      if (params.reportFailure !== false) {
        await reportFailedCancelRefund({
          order,
          amount: creditPart,
          currency,
          why: `what its return paid could not be put back on the return (${
            err instanceof Error ? err.message : "unknown error"
          })`,
        });
      }
    }
  } else if (creditPart > 0) {
    try {
      const { refundToStoreCredit } = await import("@/lib/store-credit/refund-to-credit");
      const issued = await refundToStoreCredit({
        order: { ...refundOrderShape, customerId: order.customerId },
        amount: creditPart,
        source: "order_refund_restore",
        consignmentIds: params.consignmentIds,
        reason: params.reason || "Pre-order cancelled",
        createdBy: params.createdBy || "system",
      });
      creditGiven = creditPart;
      const { notifyStoreCreditIssued } = await import(
        "@/lib/store-credit/store-credit-notify"
      );
      await notifyStoreCreditIssued({
        customerId: String(order.customerId),
        lotId: issued.lotId,
        amount: creditPart,
        currency,
        reason: "order_refund_restore",
      }).catch((err) => console.error("Failed to tell a shopper about store credit:", err));
    } catch (err) {
      console.error(`Store credit back on ${order.orderNumber} could not be given:`, err);
      await Order.updateOne(
        { _id: order._id },
        { $inc: { refundedTotal: -creditPart } },
      ).catch((rollbackErr) =>
        console.error("Failed to roll back cancel-refund claim:", rollbackErr),
      );
      if (params.reportFailure !== false) {
        await reportFailedCancelRefund({
          order,
          amount: creditPart,
          currency,
          why: `the store credit it was paid with could not be given back (${
            err instanceof Error ? err.message : "unknown error"
          })`,
        });
      }
    }
  }

  // Writes the refund row AND posts it to the ledger against the sale. Only
  // for money that went back through the way it came.
  const rowWritten =
    !(gatewayPart > 0) || gatewayRefusal
      ? true
      : await createRefundTransaction({
          order: refundOrderShape,
          amount: gatewayPart,
          reason: params.reason || "Pre-order cancelled",
          createdBy: params.createdBy,
          externalRefundId: gateway?.externalRefundId,
          externalRefundIds: gateway?.externalRefundIds,
          gatewayCalled: gateway?.gatewayCalled,
          notifySettlement: params.notifySettlement,
          consignmentIds: params.consignmentIds,
          ...(params.operationId
            ? { metadata: { preorderOperationId: params.operationId } }
            : {}),
        })
    .then(() => true)
    .catch(async (err: unknown) => {
      console.error("Failed to record pre-order cancel refund:", err);
      // The reservation stood with no row behind it, so the gateway's own
      // report reserved the same money again — counted twice, or refused at
      // the ceiling and never recorded.
      if (gateway?.gatewayCalled) {
        // Sent: handed to the gateway's report to record whole.
        const { settleRefundRecordedLate } = await import(
          "@/lib/orders/refund-recorded-late"
        );
        await settleRefundRecordedLate({
          orderId: order._id,
          orderNumber: order.orderNumber,
          amount: gatewayPart,
          currency,
          provider: gateway.provider,
          externalRefundIds:
            gateway.externalRefundIds ||
            (gateway.externalRefundId ? [gateway.externalRefundId] : []),
          refundStamp,
          error: err,
        });
      } else {
        // Nothing moved: the reservation goes back and the shopper is still
        // owed it, which somebody now has to hear.
        await Order.updateOne(
          { _id: order._id },
          { $inc: { refundedTotal: -gatewayPart } },
        ).catch((rollbackErr) =>
          console.error("Failed to roll back cancel-refund claim:", rollbackErr),
        );
        if (params.reportFailure !== false) {
          await reportFailedCancelRefund({
            order,
            amount: gatewayPart,
            currency,
            why: err instanceof Error ? err.message : "it could not be recorded",
          });
        }
      }
      return false;
    });
  await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );
  if (!rowWritten && !gateway?.gatewayCalled && !(creditGiven > 0)) {
    return {
      refunded: false,
      failed: true,
      amount,
      currency,
      reason: "The refund could not be recorded — refund this order by hand",
    };
  }
  // Nothing went back at all: the gateway refused, and the credit could not
  // be given either.
  if (gatewayRefusal && !(creditGiven > 0)) {
    return {
      refunded: false,
      failed: true,
      amount,
      currency,
      reason: `Refund this order by hand — ${gatewayRefusal}`,
    };
  }

  // The points for what went back, and only those. `reverseOrderLoyaltyPoints`
  // takes back one point per unit of the order's refunded total, so a
  // consignment refunded on its own costs the shopper that consignment's
  // points and they keep the rest. Waiting for a full refund left them the
  // points for goods they got their money back for. An order still owing a
  // balance never earned any, so there is nothing for it to take.
  if (amount > 0) {
    const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
    await reverseOrderLoyaltyPoints(String(order._id)).catch((err) =>
      console.error("Failed to reverse loyalty points on pre-order cancel:", err),
    );
  }

  const { auditOrderRefunded, systemActor } = await import(
    "@/lib/orders/audit-order"
  );
  await auditOrderRefunded(
    params.auditContext || systemActor(),
    { _id: String(order._id), orderNumber: order.orderNumber },
    {
      amount: sent,
      currency,
      reason: params.reason || "Pre-order cancelled",
      gatewayCalled: gateway?.gatewayCalled,
      full: refundsEverything && !gatewayRefusal,
      storeCredit: creditGiven,
      ...(exchangeReturnNumber ? { backOnReturn: exchangeReturnNumber } : {}),
    },
  ).catch((err) =>
    console.error("Failed to audit pre-order cancel refund:", err),
  );

  return {
    refunded: true,
    amount: sent,
    currency,
    gatewayCalled: gateway?.gatewayCalled,
    ...(gatewayRefusal
      ? { failed: true, reason: `Refund the rest by hand — ${gatewayRefusal}` }
      : {}),
  };
}

/**
 * Refund what a cancellation took off an order that had taken money.
 *
 * Every route that can cancel a paid order goes through here — the shopper,
 * a vendor calling off their consignment, an admin — because only the
 * pre-order screens used to refund at all. Anywhere else a paid order was
 * cancelled, restocked and left with the shopper's money.
 *
 * The whole order gone: everything collected and not yet refunded. Part of it
 * gone — one seller's consignment, or the un-shipped half of a split order —
 * each consignment THIS change called off gives back its own share, claimed on
 * the consignment first, so the same one cancelled twice, or by two routes at
 * once, finds nothing left to send.
 *
 * Returns undefined when nothing was collected (an unpaid order, a pay-later
 * reservation), so a caller reports a refund only when there was money.
 */
export async function refundOrderCancellation(params: {
  orderId: string;
  /** Consignments this change moved to cancelled; unused when the whole order went. */
  cancelledSubOrderIds: ReadonlyArray<unknown>;
  reason: string;
  actor?: string;
  createdBy?: string;
  auditContext?: AuditContext;
  /** See `refundCancelledPreorder`. */
  reportFailure?: boolean;
  /** See `refundCancelledPreorder`. */
  operationId?: string;
  /** See `refundCancelledPreorder`. */
  idempotencyKey?: string;
}): Promise<CancelRefundOutcome | undefined> {
  const order = (await Order.findById(params.orderId).lean()) as
    | (RefundableOrder & {
        subOrders?: Array<{
          _id?: unknown;
          status?: string;
          items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
        }> | null;
      })
    | null;
  if (!order) return undefined;

  // Goods the store's own coupon paid for in full: the sale stands on the
  // books — the seller is owed it and was charged commission on it — and no
  // refund will ever unwind it, because the shopper handed over nothing to
  // give back. Written off here, where every cancellation passes.
  const { postStoreFundedCancellationSafely } = await import(
    "@/lib/finance/post-events"
  );
  postStoreFundedCancellationSafely(params.orderId, {
    cancelledSubOrderIds: params.cancelledSubOrderIds,
  });

  // An exchange order called off before its payment came (R7): what its
  // return paid for it goes back on the return. Nothing was collected, so
  // nothing else goes back. One called off once paid goes back below.
  const collectedAny = getPreorderCollectedAmount(order) > 0;
  const wholeOrderGone =
    order.status === ORDER_STATUS.CANCELLED ||
    ((order.subOrders || []).length > 0 &&
      (order.subOrders || []).every((sub) => sub.status === ORDER_STATUS.CANCELLED));
  if (!collectedAny && wholeOrderGone && isActiveExchangeOrder(order as ExchangeOrderFields)) {
    const { undoReturnExchange } = await import("@/lib/returns/return-exchange");
    await undoReturnExchange({
      exchangeOrder: order as Parameters<typeof undoReturnExchange>[0]["exchangeOrder"],
      amount: orderCreditApplied(order),
      paid: false,
      reason: params.reason,
      createdBy: params.createdBy || "system",
      auditContext: params.auditContext,
    }).catch((err) =>
      console.error(`The exchange behind ${order.orderNumber} could not be called off:`, err),
    );
  }

  // Called off before its money came: the store credit held for it goes back
  // to the shopper now, not when the hourly sweep finds it (R8).
  if (!collectedAny && wholeOrderGone) {
    const { releaseOrderStoreCredit } = await import("@/lib/store-credit/store-credit");
    await releaseOrderStoreCredit(
      order as Parameters<typeof releaseOrderStoreCredit>[0],
    ).catch((err) =>
      console.error(`Store credit held for ${order.orderNumber} could not be given back:`, err),
    );
  }

  if (!collectedAny) return undefined;

  const refundParams = {
    orderId: params.orderId,
    reason: params.reason,
    actor: params.actor,
    createdBy: params.createdBy,
    auditContext: params.auditContext,
    reportFailure: params.reportFailure,
    operationId: params.operationId,
    idempotencyKey: params.idempotencyKey,
  };
  if (order.status === ORDER_STATUS.CANCELLED) {
    return refundCancelledPreorder(refundParams);
  }

  const wanted = new Set(params.cancelledSubOrderIds.map(String));
  const now = new Date();
  const claimed: NonNullable<typeof order.subOrders> = [];
  for (const sub of order.subOrders || []) {
    if (!wanted.has(String(sub._id)) || sub.status !== ORDER_STATUS.CANCELLED) {
      continue;
    }
    const claim = await Order.updateOne(
      {
        _id: order._id,
        subOrders: {
          $elemMatch: {
            _id: sub._id,
            status: ORDER_STATUS.CANCELLED,
            cancelRefundClaimedAt: { $exists: false },
          },
        },
      },
      { $set: { "subOrders.$.cancelRefundClaimedAt": now } },
    );
    if (claim.modifiedCount) claimed.push(sub);
  }
  // Priced in the order's currency, or the store's for an order written before
  // it carried one — without a currency the consignment cannot be priced at
  // all, and the cancellation quietly refunded nothing.
  const settings = await getSettings();
  const priced = {
    ...order,
    currency: String(
      order.currency || settings.general?.defaultCurrency || "USD",
    ).toUpperCase(),
  } as Parameters<typeof getSubOrderPreorderCollectedAmount>[0];

  // Never more of a consignment than the books still hold for it: an earlier
  // refund spread over the order has already handed part of it back.
  const unreversed = await import("@/lib/finance/post-events")
    .then(({ loadUnreversedConsignmentTotals }) =>
      loadUnreversedConsignmentTotals(order._id),
    )
    .catch((err: unknown) => {
      console.error("Failed to read what is left of the cancelled consignments:", err);
      return new Map<string, number>();
    });

  const share = Number(
    claimed
      .reduce((sum, sub) => {
        const collected = getSubOrderPreorderCollectedAmount(priced, sub);
        const left = unreversed.get(String(sub._id));
        return sum + (left === undefined ? collected : Math.min(collected, left));
      }, 0)
      .toFixed(2),
  );
  if (share <= 0) return undefined;

  const refund = await refundCancelledPreorder({
    ...refundParams,
    collected: share,
    consignmentIds: claimed.map((sub) => sub._id),
  });
  if (!refund.refunded) {
    // Nothing went back, so the consignments are still owed theirs; leaving
    // the stamps would make that money look settled.
    await Order.updateOne(
      { _id: order._id },
      { $unset: { "subOrders.$[sub].cancelRefundClaimedAt": "" } },
      { arrayFilters: [{ "sub.cancelRefundClaimedAt": now }] },
    ).catch((err) =>
      console.error("Failed to release a consignment refund claim:", err),
    );
  }
  return refund;
}
