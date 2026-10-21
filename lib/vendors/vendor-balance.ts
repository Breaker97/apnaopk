import { quotePayout } from "@/lib/finance/payout-service";
import "server-only";

import { Types } from "mongoose";
import { Order, Payout, getSettings } from "@/models";
import {
  PAYABLE_ORDER_PROJECTION,
  buildPayableOrderFilter,
  buildUndeliveredSalesFilter,
  fetchRefundTotalsByOrder,
  fetchVendorOverpayment,
  isPastPayoutHold,
  loadOrderIdsHeldForReturns,
  orderPayoutHoldCutoff,
  orderPayoutHoldDays,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { sumHeldReserve } from "@/lib/vendors/preorder-reserve";
import {
  resolveReturnPolicy,
  type ReturnTermsLike,
} from "@/lib/returns/return-policy";
import { roundMoney } from "@/lib/intl/money";
import { resolveMinWithdrawal } from "@/lib/orders/order-settings";
import { uncollectedPreorderBalanceMatch } from "@/lib/orders/order-payment-status";

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
  grossEligible?: number;
  breakdown?: Record<string, number>;
  eligible?: boolean;
  hasMore?: boolean;
  eligibilityReason?: string | null;
  calculatedAt?: Date;
  availableCurrencies?: string[];
  orderCount: number;
  /** Delivered, unpaid, still inside the return window. */
  heldInReturnWindow: { amount: number; orderCount: number; windowDays: number };
  /** A pre-order rolling reserve, and when the earliest part of it is released. */
  reserveHeld: { amount: number; releaseAt: Date | null };
  /** Paid already for sales refunded since; recovered from the next payout. */
  owedBack: number;
  /** The store's floor for creating a payout at all, in this currency. */
  minWithdrawal: number;
  /** Payouts are frozen while the seller is suspended; sales keep counting. */
  frozen?: boolean;
  /** Commission owed on cash sales that does not fit in the next payout. */
  commissionNotDeducted?: number;
  /** Paid sales whose parcel has not arrived yet. */
  notDelivered?: { amount: number; orderCount: number };
  /** Money already in a payout being prepared or sent. */
  inPayout?: { amount: number; payoutNumbers: string[] };
  /** Pre-orders whose balance the shopper still has to pay. */
  awaitingPreorderBalance?: { orderCount: number };
}

export async function loadVendorBalance(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
}): Promise<VendorBalance> {
  const vendorObjectId = new Types.ObjectId(String(params.vendorId));
  const currency = String(params.currency || "USD").toUpperCase();
  const settings = await getSettings();
  // An order written before currencies were recorded is the store's own
  // currency — as the payout quote reads it — not whichever one was asked for.
  const storeCurrency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
  const policy = resolveReturnPolicy(settings);
  const now = new Date();

  const [payableOrders, heldForReturns, quote] = await Promise.all([
    Order.find(buildPayableOrderFilter(vendorObjectId))
      .select(PAYABLE_ORDER_PROJECTION)
      .lean(),
    loadOrderIdsHeldForReturns(vendorObjectId),
    quotePayout({ vendorId: String(params.vendorId), currency, now }),
  ]);
  // A sale a return is still open on waits with the ones inside the window:
  // it is what a payout made now would leave out.
  const returnOpen = new Set(heldForReturns.map(String));
  // Each sale waits out the window it was sold with, not today's.
  const waiting = (
    sub: Parameters<typeof isPastPayoutHold>[0],
    order: { _id?: unknown; returnTerms?: ReturnTermsLike | null },
  ) =>
    !isPastPayoutHold(
      sub,
      orderPayoutHoldCutoff(order, settings, now, vendorObjectId),
    ) ||
    returnOpen.has(String(order._id));
  const refundByOrderId = await fetchRefundTotalsByOrder(
    payableOrders.map((order) => order._id as Types.ObjectId),
  );

  const isUnpaidDelivered = (sub: { status?: string; payoutStatus?: string }) =>
    sub.status === "delivered" &&
    sub.payoutStatus !== "scheduled" &&
    sub.payoutStatus !== "paid";

  const held = payableInCurrency(
    sumVendorPayable(
      payableOrders,
      vendorObjectId,
      refundByOrderId,
      (sub, order) => isUnpaidDelivered(sub) && waiting(sub, order),
      storeCurrency,
    ),
    currency,
  );

  const [owedBack, reserveHeld, nextRelease] = await Promise.all([
    fetchVendorOverpayment({ vendorId: vendorObjectId, currency, storeCurrency }),
    sumHeldReserve({ vendorId: vendorObjectId, currency, unallocatedOnly: true, excludePayoutIds: quote.reserveSourceIds }),
    // The earliest reserve still held, so the answer to "when do I get the
    // rest?" is a date rather than a shrug — which is what the field exists for.
    Payout.findOne({
      vendorId: vendorObjectId,
      currency,
      preorderReserveHeld: { $gt: 0 },
      preorderReserveReleasedAt: null,
      preorderReserveReleasedInPayoutId: null,
      ...(quote.reserveSourceIds?.length ? { _id: { $nin: quote.reserveSourceIds } } : {}),
      status: { $nin: ["cancelled", "failed"] },
    })
      .sort({ preorderReserveReleaseAt: 1 })
      .select("preorderReserveReleaseAt")
      .lean<{ preorderReserveReleaseAt?: Date | null } | null>(),
  ]);

  // Sales made under different return windows wait different times; the hint
  // names the longest of those still waiting, the one that pays out last.
  const heldIds = new Set(held.orderIds.map(String));
  const heldWindowDays = payableOrders.reduce(
    (longest, order) =>
      heldIds.has(String(order._id))
        ? Math.max(longest, orderPayoutHoldDays(order, settings, vendorObjectId))
        : longest,
    0,
  );

  // The rest of the seller's money, each row only where there is some: sales
  // still travelling, money already in a payout, and pre-orders whose balance
  // has not come in. Read beside the quote, never folded into it.
  const [undelivered, openPayouts, awaitingBalance] = await Promise.all([
    loadUndeliveredBalance(vendorObjectId, currency, storeCurrency),
    Payout.find({ vendorId: vendorObjectId, currency, status: { $in: ["pending", "processing"] } })
      .select("payoutNumber netAmount")
      .sort({ createdAt: 1 })
      .lean<Array<{ payoutNumber?: string; netAmount?: number }>>(),
    Order.countDocuments({
      $and: [
        uncollectedPreorderBalanceMatch(),
        {
          status: { $ne: "cancelled" },
          subOrders: { $elemMatch: { vendorId: vendorObjectId, status: { $ne: "cancelled" } } },
        },
        orderCurrencyMatch(currency, storeCurrency),
      ],
    }),
  ]);
  return {
    currency,
    readyToPay: quote.netAmount,
    grossEligible: quote.eligibleEarnings,
    breakdown: quote.breakdown,
    eligible: quote.eligible,
    hasMore: quote.hasMore,
    eligibilityReason: quote.eligibilityReason,
    calculatedAt: quote.calculatedAt,
    availableCurrencies: quote.availableCurrencies,
    orderCount: quote.orderCount,
    heldInReturnWindow: {
      amount: roundMoney(held.netAmount),
      orderCount: held.orderIds.length,
      // With nothing held, the store's own window — or, with no time limit,
      // the most a payout waits on it.
      windowDays: heldWindowDays || (policy.windowDays ?? policy.payoutHoldMaxDays),
    },
    reserveHeld: {
      amount: roundMoney(reserveHeld),
      releaseAt: nextRelease?.preorderReserveReleaseAt ?? null,
    },
    owedBack: roundMoney(owedBack),
    minWithdrawal: resolveMinWithdrawal(settings, currency),
    frozen: Boolean(quote.frozen),
    commissionNotDeducted: quote.commissionOwedNotDeducted,
    notDelivered: undelivered,
    inPayout: {
      amount: roundMoney(openPayouts.reduce((sum, payout) => sum + Number(payout.netAmount || 0), 0)),
      payoutNumbers: openPayouts.map((payout) => payout.payoutNumber || "").filter(Boolean),
    },
    awaitingPreorderBalance: { orderCount: awaitingBalance },
  };
}

function orderCurrencyMatch(currency: string, storeCurrency: string) {
  return currency === storeCurrency
    ? { $or: [{ currency }, { currency: null }, { currency: "" }] }
    : { currency };
}

/** Bound each read, not the total: a large vendor must still see all their money. */
async function loadUndeliveredBalance(vendorId: Types.ObjectId, currency: string, storeCurrency: string) {
  const batchSize = 500;
  let cursor: Types.ObjectId | undefined;
  let amount = 0;
  let orderCount = 0;
  for (;;) {
    const orders = await Order.find({ $and: [
      buildUndeliveredSalesFilter(vendorId),
      orderCurrencyMatch(currency, storeCurrency),
      ...(cursor ? [{ _id: { $gt: cursor } }] : []),
    ] }).select(PAYABLE_ORDER_PROJECTION).sort({ _id: 1 }).limit(batchSize).lean();
    if (!orders.length) break;
    const totals = payableInCurrency(sumVendorPayable(
      orders, vendorId,
      await fetchRefundTotalsByOrder(orders.map(order => order._id as Types.ObjectId)),
      sub => sub.status !== "delivered" && sub.status !== "cancelled",
      storeCurrency, { unfloored: true },
    ), currency);
    amount += totals.netAmount;
    orderCount += totals.orderIds.length;
    if (orders.length < batchSize) break;
    cursor = orders[orders.length - 1]._id as Types.ObjectId;
  }
  return { amount: roundMoney(Math.max(0, amount)), orderCount };
}

/**
 * What a suspended seller is shown in place of their dashboard: what is held
 * for them and their latest payouts. Never throws — the status page must
 * render even when the ledger cannot be read.
 */
export async function loadSuspendedSellerMoney(vendorId: string, currency: string): Promise<{
  currency: string;
  ready: number;
  held: number;
  payouts: Array<{ number: string; status: string; net: number; currency: string; createdAt: string }>;
} | null> {
  try {
    const balance = await loadVendorBalance({ vendorId, currency });
    const payouts = await Payout.find({ vendorId: new Types.ObjectId(vendorId) })
      .select("payoutNumber status netAmount currency createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean<Array<{ payoutNumber?: string; status?: string; netAmount?: number; currency?: string; createdAt?: Date }>>();
    return {
      currency: balance.currency,
      ready: balance.readyToPay,
      held: roundMoney(balance.heldInReturnWindow.amount + (balance.notDelivered?.amount ?? 0)),
      payouts: payouts.map((payout) => ({
        number: payout.payoutNumber || "",
        status: payout.status || "pending",
        net: Number(payout.netAmount || 0),
        currency: payout.currency || balance.currency,
        createdAt: (payout.createdAt ?? new Date()).toISOString(),
      })),
    };
  } catch (error) {
    console.error("Failed to read a suspended seller's money:", error);
    return null;
  }
}
