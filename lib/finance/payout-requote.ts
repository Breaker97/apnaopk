import "server-only";
import { Types } from "mongoose";
import { CommissionInvoice, Order, Payout, PaymentTransaction, ReturnRequest } from "@/models";
import { PAYOUT_HOLDING_RETURN_STATUSES } from "@/lib/returns/returns";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { SETTLED_PAYMENT_STATUSES } from "@/lib/orders/order-payment-status";
import { buildPayableOrderFilter } from "@/lib/vendors/vendor-earnings";
import { roundMoney } from "@/lib/intl/money";
import { describeCommissionClaimChange } from "./commission-invoices";
import { financeQuery } from "./transaction";

/**
 * A payout fixes its amount when it is created, and it is paid days later.
 * Whatever happens to its orders in between — a return opened, a refund
 * issued, a delivery taken back, a consignment cancelled — the payout used to
 * pay the old amount anyway, and the difference could only be clawed back
 * from a payout that might never come.
 *
 * Two halves. Each event that can change what a scheduled sale is worth flags
 * the payouts holding it (`flagScheduledPayoutsForOrder`), so the admin sees
 * it the moment they open the payout. And marking a payout paid re-reads its
 * orders (`describePayoutSourceChange`), because no list of events is ever
 * complete and the check at payment time is the one that cannot be missed.
 */

export const PAYOUT_REQUOTE_MESSAGE =
  "Orders in this payout changed after it was made. Cancel it and create a new one.";

type ScheduledSub = {
  vendorId?: unknown;
  payoutStatus?: string | null;
  payoutId?: unknown;
  commissionSettlementId?: unknown;
};

/**
 * Flag the open payouts holding this order's consignments for a new quote.
 *
 * `vendorIds` narrows it to those sellers' consignments — a return of one
 * seller's goods does not change what another is owed. Null or omitted means
 * every seller on the order (an unitemised refund is shared by all of them);
 * an empty list means none — the store's own goods, say.
 *
 * A payout holds a sale two ways: its own claim on the sale (`payoutId`), and,
 * for a cash sale the seller took the money for, the commission invoice that
 * deducts or credits it (`commissionSettlementId`). Both are followed. A
 * return merely being opened passes `reachesCommissionSettlements: false`: it
 * changes no money on a cash sale until it becomes a refund.
 *
 * Never throws. The event that called it (a refund already sent, a return
 * already opened) must not fail because of this, and the payment-time check
 * catches anything a lost flag would have shown.
 */
export async function flagScheduledPayoutsForOrder(params: {
  orderId: unknown;
  vendorIds?: ReadonlyArray<unknown> | null;
  reason: string;
  reachesCommissionSettlements?: boolean;
}): Promise<number> {
  try {
    if (!params.orderId || !Types.ObjectId.isValid(String(params.orderId))) return 0;
    const order = await Order.findById(params.orderId)
      .select("subOrders.vendorId subOrders.payoutStatus subOrders.payoutId subOrders.commissionSettlementId")
      .lean<{ subOrders?: ScheduledSub[] } | null>();
    const wanted = params.vendorIds
      ? new Set(params.vendorIds.filter(Boolean).map(String))
      : null;
    if (wanted && wanted.size === 0) return 0;
    const ofWantedSeller = (sub: ScheduledSub) => !wanted || wanted.has(String(sub?.vendorId));
    const payoutIds = new Set(
      (order?.subOrders || [])
        .filter((sub) => sub?.payoutStatus === "scheduled" && sub.payoutId && ofWantedSeller(sub))
        .map((sub) => String(sub.payoutId)),
    );
    const settlementIds = params.reachesCommissionSettlements === false
      ? []
      : (order?.subOrders || [])
          .filter((sub) => sub?.commissionSettlementId && ofWantedSeller(sub))
          .map((sub) => String(sub.commissionSettlementId));
    if (settlementIds.length > 0) {
      // Only an invoice a payout is deducting: one the seller pays themselves
      // is theirs to settle, and a refund reaches it as a credit afterwards.
      const invoices = await CommissionInvoice.find({
        _id: { $in: [...new Set(settlementIds)].map((id) => new Types.ObjectId(id)) },
        status: "open",
        payoutId: { $ne: null },
      })
        .select("payoutId")
        .lean<Array<{ payoutId?: unknown }>>();
      for (const invoice of invoices) if (invoice.payoutId) payoutIds.add(String(invoice.payoutId));
    }
    if (payoutIds.size === 0) return 0;
    const result = await Payout.updateMany(
      {
        _id: { $in: [...payoutIds].map((id) => new Types.ObjectId(id)) },
        status: { $in: ["pending", "processing"] },
        requiresRequote: { $ne: true },
      },
      {
        $set: { requiresRequote: true, requoteReason: params.reason.slice(0, 200) },
        $inc: { version: 1 },
      },
    );
    return result.modifiedCount ?? 0;
  } catch (error) {
    console.error("Failed to flag scheduled payouts for a new quote:", error);
    return 0;
  }
}

type ClaimedSub = {
  _id?: unknown;
  vendorId?: unknown;
  payoutId?: unknown;
  payoutStatus?: string | null;
  paymentStatus?: string | null;
  status?: string;
  payoutClaimedAt?: Date | null;
  codCollectedBy?: string | null;
  fulfillment?: { method?: string } | null;
};

type ClaimedOrder = {
  _id: Types.ObjectId;
  paymentMethod?: string | null;
  channel?: string | null;
  stripePaymentIntentId?: string | null;
  paymentCustody?: string | null;
  subOrders?: ClaimedSub[];
};

/**
 * What a payout was made of, against what it still holds.
 *
 * The payout's saved allocation names every sale and consignment it paid for.
 * Each must still be claimed by it, and by nothing else, and still be a sale a
 * payout may hold: a claim lost to a repair or an import, a consignment
 * reassigned to another payout, a payment corrected back to unpaid. Read the
 * other way round — "whatever it happens to find is fine" — a payout whose
 * claim vanished found nothing and was paid, and the same sale could then be
 * drawn into a second payout.
 *
 * Returns null when it cannot tell: a payout with neither an allocation nor an
 * order list to compare with.
 */
async function describeClaimDrift(
  payout: {
    _id: unknown;
    vendorId: unknown;
    allocations?: ReadonlyArray<{ orderId?: unknown; consignmentIds?: ReadonlyArray<unknown> | null }> | null;
    orderIds?: ReadonlyArray<unknown> | null;
  },
  orders: ClaimedOrder[],
): Promise<string | null> {
  const expected = new Map<string, Set<string> | null>();
  if (Array.isArray(payout.allocations)) {
    for (const row of payout.allocations) {
      const ids = (row.consignmentIds ?? []).filter(Boolean).map(String);
      expected.set(String(row.orderId), ids.length > 0 ? new Set(ids) : null);
    }
  } else if (Array.isArray(payout.orderIds)) {
    for (const id of payout.orderIds) expected.set(String(id), null);
  } else {
    return null;
  }

  const payoutKey = String(payout._id);
  const vendorKey = String(payout.vendorId);
  const live = new Map<string, { order: ClaimedOrder; subs: ClaimedSub[] }>();
  for (const order of orders) {
    const subs = (order.subOrders || []).filter(
      (sub) => String(sub.payoutId) === payoutKey && String(sub.vendorId) === vendorKey,
    );
    if (subs.length > 0) live.set(String(order._id), { order, subs });
  }

  for (const [orderId, consignmentIds] of expected) {
    const held = live.get(orderId);
    if (!held) return "A sale in this payout is no longer claimed by it.";
    if (consignmentIds) {
      const heldIds = new Set(held.subs.map((sub) => String(sub._id)));
      const same = heldIds.size === consignmentIds.size && [...consignmentIds].every((id) => heldIds.has(id));
      if (!same) return "The consignments this payout claimed have changed.";
    }
  }
  for (const orderId of live.keys()) {
    if (!expected.has(orderId)) return "This payout holds a sale it was not made for.";
  }

  for (const { order, subs } of live.values()) {
    for (const sub of subs) {
      if (sub.payoutStatus !== "scheduled") return "A sale in this payout is no longer scheduled for it.";
      const settled = sub.paymentStatus == null || SETTLED_PAYMENT_STATUSES.includes(sub.paymentStatus);
      if (!settled || !isPlatformSettled(order, sub)) return "A sale in this payout is no longer paid to the store.";
    }
  }
  if (live.size > 0) {
    // The order-level half of the rule the claim used: not called off, money in,
    // no pre-order balance outstanding. At least one consignment on each order
    // matching is all the filter can say; the loop above checked each one.
    const payable = await financeQuery(Order.countDocuments({
      _id: { $in: [...live.keys()].map((id) => new Types.ObjectId(id)) },
      ...buildPayableOrderFilter(payout.vendorId as Types.ObjectId, undefined, undefined, undefined, payout._id as Types.ObjectId),
    }));
    if (payable !== live.size) return "A sale in this payout can no longer be paid out.";
  }
  return null;
}

/**
 * The reserve a payout releases must still be the reserve it claimed. Sums what
 * the payouts stamped with this one's id hold, and compares it with what this
 * one paid out; a reserve reassigned to another payout, or returned, no longer
 * adds up.
 */
async function describeReserveDrift(payout: {
  _id: unknown;
  preorderReserveReleased?: number | null;
}): Promise<string | null> {
  const released = roundMoney(Number(payout.preorderReserveReleased || 0));
  if (released <= 0) return null;
  const claimed = await financeQuery(
    Payout.find({ preorderReserveReleasedInPayoutId: new Types.ObjectId(String(payout._id)) }).select("preorderReserveHeld"),
  ).lean<Array<{ preorderReserveHeld?: number | null }>>();
  const held = roundMoney(claimed.reduce((sum, row) => sum + Number(row.preorderReserveHeld || 0), 0));
  return held === released ? null : "The reserve this payout releases has changed.";
}

/**
 * Why this payout can no longer be paid as calculated, or null when nothing
 * it claimed has changed. Read inside the payout's own transaction.
 *
 * Two kinds of source: the sales the payout claimed outright, and the cash
 * sales its commission invoice deducts or credits. A payout that only credits
 * the store's promotions has no claims of its own at all — everything it pays
 * rests on the invoice's sales.
 */
export async function describePayoutSourceChange(payout: {
  _id: unknown;
  vendorId: unknown;
  calculatedAt?: Date | null;
  createdAt?: Date | null;
  commissionInvoiceId?: unknown;
  allocations?: ReadonlyArray<{ orderId?: unknown; consignmentIds?: ReadonlyArray<unknown> | null }> | null;
  orderIds?: ReadonlyArray<unknown> | null;
  preorderReserveReleased?: number | null;
}): Promise<string | null> {
  const payoutId = new Types.ObjectId(String(payout._id));
  const vendorKey = String(payout.vendorId);
  const orders = await financeQuery(
    Order.find({ "subOrders.payoutId": payoutId }).select(
      "paymentMethod channel stripePaymentIntentId paymentCustody " +
        "subOrders._id subOrders.vendorId subOrders.payoutId subOrders.payoutStatus subOrders.paymentStatus " +
        "subOrders.status subOrders.payoutClaimedAt subOrders.codCollectedBy subOrders.fulfillment.method",
    ),
  ).lean<ClaimedOrder[]>();

  const claimedAtByOrder = new Map<string, Date>();
  for (const order of orders) {
    for (const sub of order.subOrders || []) {
      if (String(sub.payoutId) !== String(payoutId)) continue;
      if (sub.status !== "delivered") {
        return "A consignment in this payout is no longer delivered.";
      }
      const claimedAt =
        sub.payoutClaimedAt ?? payout.calculatedAt ?? payout.createdAt ?? new Date(0);
      claimedAtByOrder.set(String(order._id), new Date(claimedAt));
    }
  }
  const orderIds = orders.map((order) => order._id);

  const drifted = await describeClaimDrift(payout, orders);
  if (drifted) return drifted;
  const reserveDrift = await describeReserveDrift(payout);
  if (reserveDrift) return reserveDrift;

  if (payout.commissionInvoiceId) {
    const settlement = await describeCommissionClaimChange(String(payout.commissionInvoiceId));
    if (settlement.reason) return settlement.reason;
    // The earlier claim wins where one order sits in both.
    for (const [orderId, claimedAt] of settlement.claimedAtByOrder) {
      const earlier = claimedAtByOrder.get(orderId);
      if (!earlier || claimedAt < earlier) claimedAtByOrder.set(orderId, claimedAt);
    }
  }
  if (claimedAtByOrder.size === 0) return null;

  // Only the sales the payout claimed outright are held back by an open return.
  // A cash sale in the commission invoice moves no money until the return
  // becomes a refund, and the refund check below catches that.
  if (orderIds.length > 0) {
    const openReturn = await financeQuery(
      ReturnRequest.exists({
        orderId: { $in: orderIds },
        vendorIds: new Types.ObjectId(vendorKey),
        status: { $in: PAYOUT_HOLDING_RETURN_STATUSES },
      }),
    );
    if (openReturn) return "A return is open on an order in this payout.";
  }

  const earliest = Math.min(
    ...[...claimedAtByOrder.values()].map((date) => date.getTime()),
  );
  const refunds = await financeQuery(
    PaymentTransaction.find({
      orderId: { $in: [...claimedAtByOrder.keys()].map((id) => new Types.ObjectId(id)) },
      type: "refund",
      status: { $in: ["pending", "succeeded"] },
      createdAt: { $gt: new Date(earliest) },
    }).select("orderId createdAt refundAllocation"),
  ).lean<
    Array<{
      orderId: unknown;
      createdAt?: Date;
      refundAllocation?: Array<{ vendorId?: unknown }> | null;
    }>
  >();
  const touchesThisSeller = refunds.some((refund) => {
    const claimedAt = claimedAtByOrder.get(String(refund.orderId));
    if (!claimedAt || !refund.createdAt || refund.createdAt <= claimedAt) return false;
    const shares = refund.refundAllocation || [];
    // An unitemised refund is spread over every seller on the order.
    if (shares.length === 0) return true;
    return shares.some((share) => String(share.vendorId) === vendorKey);
  });
  if (touchesThisSeller) return "An order in this payout was refunded after it was made.";

  return null;
}

/**
 * `flagScheduledPayoutsForOrder` for refund rows just written: each names its
 * sellers through its allocation, and one without an allocation is spread
 * over every seller on its order.
 */
export async function flagScheduledPayoutsForRefunds(
  refunds: ReadonlyArray<{
    orderId?: unknown;
    grossAmount?: number | null;
    refundAllocation?: ReadonlyArray<{ vendorId?: unknown }> | null;
  }>,
): Promise<void> {
  for (const refund of refunds) {
    const shares = refund.refundAllocation || [];
    await flagScheduledPayoutsForOrder({
      orderId: refund.orderId,
      vendorIds:
        shares.length > 0 ? shares.map((share) => share.vendorId).filter(Boolean) : null,
      reason: `A refund of ${Number(refund.grossAmount || 0)} was issued on this order.`,
    });
  }
}
