import "server-only";

import { Types } from "mongoose";
import { Order, Payout, getSettings } from "@/models";
import {
  PAYABLE_ORDER_PROJECTION,
  buildPayableOrderFilter,
  fetchRefundTotalsByOrder,
  fetchVendorOverpayment,
  isPastPayoutHold,
  payableInCurrency,
  payoutHoldCutoff,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { sumHeldReserve } from "@/lib/vendors/preorder-reserve";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";
import { roundMoney } from "@/lib/intl/money";
import { resolveMinWithdrawal } from "@/lib/orders/order-settings";

/**
 * What a seller is owed, what is being held back, and what they owe — the same
 * split the admin's vendor finance screen has always had.
 *
 * A seller saw one number: "held for you". Inside it sat sales still inside
 * the store's return window, deposits whose balance never arrived, and a
 * rolling reserve — none of it distinguishable, none of it with a date. And
 * when a shopper returned goods after the seller had already been paid for
 * them, the debt came off their next payout with nothing anywhere to say why:
 * the figure simply went down, or went negative, unexplained.
 *
 * Everything here is read from the same functions payout creation uses, so
 * "ready for the next payout" is what a payout made now would actually carry.
 */
export interface VendorBalance {
  currency: string;
  /** Past the payout hold: what a payout created now would pay. */
  readyToPay: number;
  orderCount: number;
  /** Delivered, unpaid, still inside the return window. */
  heldInReturnWindow: { amount: number; orderCount: number; windowDays: number };
  /** A pre-order rolling reserve, and when the earliest part of it is released. */
  reserveHeld: { amount: number; releaseAt: Date | null };
  /** Paid already for sales refunded since; recovered from the next payout. */
  owedBack: number;
  /** The store's floor for creating a payout at all, in this currency. */
  minWithdrawal: number;
}

export async function loadVendorBalance(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
}): Promise<VendorBalance> {
  const vendorObjectId = new Types.ObjectId(String(params.vendorId));
  const currency = String(params.currency || "USD").toUpperCase();
  const settings = await getSettings();
  const policy = resolveReturnPolicy(settings);
  const holdCutoff = payoutHoldCutoff(settings);

  const payableOrders = await Order.find(buildPayableOrderFilter(vendorObjectId))
    .select(PAYABLE_ORDER_PROJECTION)
    .lean();
  const refundByOrderId = await fetchRefundTotalsByOrder(
    payableOrders.map((order) => order._id as Types.ObjectId),
  );

  const isUnpaidDelivered = (sub: { status?: string; payoutStatus?: string }) =>
    sub.status === "delivered" &&
    sub.payoutStatus !== "scheduled" &&
    sub.payoutStatus !== "paid";

  const ready = payableInCurrency(
    sumVendorPayable(
      payableOrders,
      vendorObjectId,
      refundByOrderId,
      (sub) => isUnpaidDelivered(sub) && isPastPayoutHold(sub, holdCutoff),
      currency,
    ),
    currency,
  );
  const held = payableInCurrency(
    sumVendorPayable(
      payableOrders,
      vendorObjectId,
      refundByOrderId,
      (sub) => isUnpaidDelivered(sub) && !isPastPayoutHold(sub, holdCutoff),
      currency,
    ),
    currency,
  );

  const [owedBack, reserveHeld, nextRelease] = await Promise.all([
    fetchVendorOverpayment({ vendorId: vendorObjectId, currency }),
    sumHeldReserve({ vendorId: vendorObjectId, currency }),
    // The earliest reserve still held, so the answer to "when do I get the
    // rest?" is a date rather than a shrug — which is what the field exists for.
    Payout.findOne({
      vendorId: vendorObjectId,
      currency,
      preorderReserveHeld: { $gt: 0 },
      preorderReserveReleasedAt: null,
      status: { $nin: ["cancelled", "failed"] },
    })
      .sort({ preorderReserveReleaseAt: 1 })
      .select("preorderReserveReleaseAt")
      .lean<{ preorderReserveReleaseAt?: Date | null } | null>(),
  ]);

  return {
    currency,
    readyToPay: roundMoney(ready.netAmount),
    orderCount: ready.orderIds.length,
    heldInReturnWindow: {
      amount: roundMoney(held.netAmount),
      orderCount: held.orderIds.length,
      windowDays: policy.windowDays,
    },
    reserveHeld: {
      amount: roundMoney(reserveHeld),
      releaseAt: nextRelease?.preorderReserveReleaseAt ?? null,
    },
    owedBack: roundMoney(owedBack),
    minWithdrawal: resolveMinWithdrawal(settings, currency),
  };
}
