import { Order, PaymentTransaction } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import type { AuditContext } from "@/lib/audit";
import { refundOrderPayment } from "@/lib/orders/order-refund";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
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
};

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
function getOrderCollectedAmount(order: RefundableOrder & { currency: string }): number {
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (Number(order.preorderOutstandingAmount || 0) > 0 || subOrders.length < 2) {
    return getPreorderCollectedAmount(order);
  }
  const priced = order as Parameters<typeof getSubOrderPreorderCollectedAmount>[0];
  if (!consignmentCharge(priced, subOrders[0]?._id)) {
    return getPreorderCollectedAmount(order);
  }
  return Number(
    subOrders
      .reduce((sum, sub) => sum + getSubOrderPreorderCollectedAmount(priced, sub), 0)
      .toFixed(2),
  );
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
   * The consignments `collected` belongs to. Recorded with the refund, so the
   * ledger and the payouts take it back from those sellers alone instead of
   * spreading one seller's cancellation over everybody on the order.
   */
  consignmentIds?: ReadonlyArray<unknown>;
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
  // Never more than is left unrefunded on the order as a whole: two
  // consignments cancelled in turn each ask for their own share, and a stale
  // read must not let the pair exceed what arrived.
  const amount = Number(
    Math.min(collected, collectedOnOrder - alreadyRefunded).toFixed(2),
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
  const refundsEverything =
    !balanceStillToCome && alreadyRefunded + amount >= collectedOnOrder - 0.01;

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
    return {
      refunded: false,
      reason: "Another refund on this order used up the remaining amount",
    };
  }

  let gateway: Awaited<ReturnType<typeof refundOrderPayment>>;
  try {
    gateway = await refundOrderPayment({
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
      amount,
      reason: params.reason || "Pre-order cancelled",
      actor: params.actor,
    });
  } catch (err) {
    // Unlike the admin route, a gateway failure here must NOT throw: the
    // cancellation itself has already happened and is not being undone. Give
    // the headroom back and report it, so the caller can tell an admin the
    // money still has to go back by hand instead of a silent success.
    await Order.updateOne(
      { _id: order._id },
      { $inc: { refundedTotal: -amount } },
    ).catch((rollbackErr) =>
      console.error("Failed to roll back cancel-refund claim:", rollbackErr),
    );
    await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );
    return {
      refunded: false,
      amount,
      currency,
      reason:
        err instanceof Error
          ? `Refund this order by hand — ${err.message}`
          : "Refund this order by hand — the gateway refused the refund",
    };
  }

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
    : refundsEverything
      ? PAYMENT_STATUS.REFUNDED
      : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  // Part-paid is guarded, because "still to come" was read before the gateway
  // call: a balance that arrived in the meantime has already marked the order
  // paid, and part-paid written over that would ask for the balance again.
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

  // Writes the refund row AND posts it to the ledger against the sale.
  await createRefundTransaction({
    order: {
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
      posLocationId: order.posLocationId
        ? String(order.posLocationId)
        : undefined,
      createdAt: order.createdAt,
    },
    amount,
    reason: params.reason || "Pre-order cancelled",
    createdBy: params.createdBy,
    externalRefundId: gateway?.externalRefundId,
    externalRefundIds: gateway?.externalRefundIds,
    gatewayCalled: gateway?.gatewayCalled,
    notifySettlement: params.notifySettlement,
    consignmentIds: params.consignmentIds,
  }).catch((err) =>
    console.error("Failed to record pre-order cancel refund:", err),
  );
  await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );

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
      amount,
      currency,
      reason: params.reason || "Pre-order cancelled",
      gatewayCalled: gateway?.gatewayCalled,
      full: refundsEverything,
    },
  ).catch((err) =>
    console.error("Failed to audit pre-order cancel refund:", err),
  );

  return {
    refunded: true,
    amount,
    currency,
    gatewayCalled: gateway?.gatewayCalled,
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

  if (getPreorderCollectedAmount(order) <= 0) return undefined;

  const refundParams = {
    orderId: params.orderId,
    reason: params.reason,
    actor: params.actor,
    createdBy: params.createdBy,
    auditContext: params.auditContext,
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
