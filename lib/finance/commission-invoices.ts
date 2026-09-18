import "server-only";

/**
 * Collecting commission the platform never got to deduct.
 *
 * A payout is the platform handing a vendor their share of money it already
 * holds. For a cash sale that direction does not exist: the merchant took the
 * notes at their own counter, so they hold all of it and the platform is the
 * one owed. `lib/payment-custody.ts` decides which sales those are; this module
 * turns the resulting balance into something collectable.
 *
 * It deliberately mirrors `POST /api/admin/payouts` rather than inventing a
 * second bookkeeping style: raise a row, CLAIM the sub-orders onto it so
 * nothing else can bill them, and roll the claim back if the row does not
 * survive. The claim is what makes the balance safe to show — an amount that
 * two invoices could each collect is worse than no amount at all.
 *
 * The invoice is the DEBT. Payment attempts are separate `PlatformPayment` rows
 * pointing back at it (kind `commission`), exactly as boost attempts point at a
 * campaign — so a vendor abandoning one checkout and completing another leaves
 * two attempts behind without either the amount or the claimed sales moving.
 */

import { Types } from "mongoose";

import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";
import {
  COMMISSION_INVOICE_STATUS,
  CommissionInvoice,
} from "@/models/commissionInvoice.model";
import {
  PAYABLE_ORDER_PROJECTION,
  buildCommissionOwedOrderFilter,
  fetchRefundTotalsByOrder,
  fetchVendorCommissionCredit,
  isCommissionOwedSubOrder,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { roundMoney } from "@/lib/intl/money";

type CommissionOwed = {
  /** The currency this balance is in — an invoice can only be raised in one. */
  currency: string;
  /** Commission due, after the same refund and coupon ratios a payout applies. */
  amount: number;
  /**
   * Commission already paid on sales refunded afterwards, netted off `amount`.
   *
   * Reported separately as well as deducted, because a vendor whose whole bill
   * is covered by a credit sees a zero and deserves to know why it is zero.
   */
  creditApplied: number;
  /** What was owed before the credit came off. */
  grossOwed: number;
  /**
   * What the store owes the vendor for its own promotions on these sales —
   * already netted off `grossOwed` before the credit. See `promotionCredit`
   * in lib/vendors/vendor-earnings.ts.
   */
  promotionCredit: number;
  /**
   * Where that promotion credit is larger than the commission: what the store
   * owes the vendor on balance. Never billed — a payout pays it.
   */
  storeOwes: number;
  /** What the vendor sold and kept the money for. */
  grossSales: number;
  orderCount: number;
  orderIds: string[];
  /**
   * Currencies the vendor also owes in, which THIS invoice cannot bill.
   *
   * Named rather than dropped: an invoice is raised in one currency, and a
   * balance nobody is told about is a balance nobody collects.
   */
  otherCurrencies: string[];
};

/**
 * What `vendorId` currently owes IN `currency`, ignoring anything an open
 * invoice has already claimed.
 *
 * Refunds matter here exactly as much as they do on a payout: goods that came
 * back carry their commission back with them, and billing the full amount would
 * have the platform collecting on a sale that partly un-happened.
 *
 * With `billVendorCodShipping` on, this also covers the delivery the vendor
 * took at the door — money the platform charged for and, until that setting
 * existed, never billed back. See finding F5 in the audit.
 *
 * Scoped to one currency because the invoice it feeds is. Summing a vendor's
 * UGX and USD sales into one figure and stamping the store's currency on it
 * billed an amount that was not owed in any currency at all.
 */
export async function commissionOwedForVendor(
  vendorId: Types.ObjectId | string,
  currency: string,
  range?: { periodStart?: Date; periodEnd?: Date },
): Promise<CommissionOwed> {
  await connectDB();
  const wanted = String(currency || "USD").trim().toUpperCase();

  const orders = await Order.find(
    buildCommissionOwedOrderFilter(vendorId, range),
  )
    .select(PAYABLE_ORDER_PROJECTION)
    .lean();

  const refundByOrderId = await fetchRefundTotalsByOrder(
    orders.map((order) => order._id as Types.ObjectId),
  );
  // The one caller that may add delivery to the debt. A payout never does:
  // there the platform is holding the money and paying the vendor out of it,
  // so billing them for delivery would charge them twice.
  const policy = resolveReturnPolicy(await getSettings());
  const byCurrency = sumVendorPayable(
    orders,
    vendorId,
    refundByOrderId,
    isCommissionOwedSubOrder,
    wanted,
    { billVendorCodShipping: policy.billVendorCodShipping },
  );
  const totals = payableInCurrency(byCurrency, wanted);

  // Commission the vendor has already paid on sales that were refunded after
  // they paid it. The platform owes it back; netting it off the next bill is
  // how it gets back without needing a payment rail of its own.
  const credit = await fetchVendorCommissionCredit({ vendorId, currency: wanted });
  const grossOwed = roundMoney(totals.commissionAmount);
  // The store's promotions on these sales come off first: the vendor collected
  // the discounted price of goods they are owed the full price for.
  const promotionCredit = roundMoney(totals.promotionCredit);
  const afterPromotions = roundMoney(grossOwed - promotionCredit);
  const creditApplied = roundMoney(Math.min(credit, Math.max(0, afterPromotions)));

  return {
    currency: wanted,
    // Only the commission column is meaningful — `netAmount` is what the
    // platform would owe the vendor, and on these sales it owes them nothing.
    amount: Math.max(0, roundMoney(afterPromotions - creditApplied)),
    creditApplied,
    grossOwed,
    promotionCredit,
    storeOwes: Math.max(0, roundMoney(-afterPromotions)),
    grossSales: roundMoney(totals.grossSales),
    orderCount: totals.orderIds.length,
    orderIds: totals.orderIds,
    otherCurrencies: byCurrency
      .filter((row) => row.currency !== wanted && row.commissionAmount > 0)
      .map((row) => row.currency)
      .sort(),
  };
}

/**
 * Raise an invoice for everything `vendorId` currently owes, claiming those
 * sales onto it.
 *
 * The claim is a compare-and-set on the sub-orders themselves — the array
 * filter re-asserts "still unclaimed" at write time — so two admins pressing
 * the button at once cannot both bill the same sale. Whichever write lands
 * second claims nothing and its invoice is deleted.
 *
 * Returns null when there is nothing to bill, which is the normal state for a
 * vendor who only sells online.
 */
export async function createCommissionInvoice(input: {
  vendorId: string;
  userId: string;
  currency: string;
  note?: string;
  range?: { periodStart?: Date; periodEnd?: Date };
  /**
   * The payout this bill is being deducted from, when it is not the vendor's
   * to pay — see `CommissionInvoice.payoutId`.
   */
  payoutId?: Types.ObjectId | string;
}): Promise<{
  invoiceId: string;
  amount: number;
  /** What the store owes on balance for these sales; only a payout carries it. */
  storeOwes: number;
  currency: string;
  orderCount: number;
  /** Balances this invoice could not bill, because they are in another currency. */
  otherCurrencies: string[];
} | null> {
  await connectDB();

  const owed = await commissionOwedForVendor(
    input.vendorId,
    input.currency,
    input.range,
  );
  // A bill with nothing to collect is not raised — except by a payout, which
  // settles the sales it claims whichever way the balance runs, and pays the
  // vendor what the store owes on them.
  const worthClaiming =
    owed.amount > 0 || (Boolean(input.payoutId) && owed.storeOwes > 0);
  if (!worthClaiming || owed.orderIds.length === 0) return null;

  const vendorObjectId = new Types.ObjectId(input.vendorId);
  const orderObjectIds = owed.orderIds.map((id) => new Types.ObjectId(id));

  const invoice = await CommissionInvoice.create({
    vendorId: vendorObjectId,
    orderIds: orderObjectIds,
    amount: owed.amount,
    // What the credit already took off this bill, so the next invoice does not
    // take it off again.
    creditApplied: owed.creditApplied,
    storeOwes: owed.storeOwes,
    currency: input.currency.toUpperCase(),
    status: COMMISSION_INVOICE_STATUS.OPEN,
    payoutId: input.payoutId ? new Types.ObjectId(String(input.payoutId)) : null,
    createdBy: input.userId,
    note: input.note?.trim() || null,
  });

  const claim = await Order.updateMany(
    { _id: { $in: orderObjectIds } },
    {
      $set: {
        "subOrders.$[so].commissionSettlementId": invoice._id,
        // The moment the bill's amount was fixed. A refund that lands before
        // the vendor pays it is not on the bill, and has to be credited back —
        // measured from payment, it read as already deducted and never was.
        "subOrders.$[so].commissionClaimedAt": invoice.createdAt ?? new Date(),
      },
    },
    {
      arrayFilters: [
        {
          "so.vendorId": vendorObjectId,
          "so.status": "delivered",
          // Re-asserted at write time, not merely read a moment ago. This is
          // the line that makes a concurrent second invoice claim nothing.
          "so.commissionSettledAt": { $exists: false },
          "so.commissionSettlementId": { $exists: false },
        },
      ],
    },
  );

  if (claim.modifiedCount === 0) {
    // Someone else claimed them between the read and the write. Nothing carries
    // this invoice's id, so there is nothing to roll back — just drop the row
    // rather than leave an invoice billing nobody.
    await CommissionInvoice.deleteOne({ _id: invoice._id });
    return null;
  }

  // Billed on what THIS invoice actually claimed, not on what was read before
  // the claim. A second invoice (or a payout's deduction) raised at the same
  // moment can win some of the same sales, and the amount worked out from the
  // read still charged for them — the same commission billed on two invoices.
  const claimed = await billedOnClaim({
    invoiceId: invoice._id as Types.ObjectId,
    vendorId: vendorObjectId,
    currency: owed.currency,
    creditAvailable: owed.creditApplied,
  });
  const claimedWorth =
    claimed.amount > 0 || (Boolean(input.payoutId) && claimed.storeOwes > 0);
  if (!claimedWorth || claimed.orderIds.length === 0) {
    await releaseCommissionInvoice(String(invoice._id), "cancelled");
    await CommissionInvoice.deleteOne({ _id: invoice._id });
    return null;
  }
  if (
    claimed.amount !== owed.amount ||
    claimed.creditApplied !== owed.creditApplied ||
    claimed.storeOwes !== owed.storeOwes ||
    claimed.orderIds.length !== owed.orderIds.length
  ) {
    await CommissionInvoice.updateOne(
      { _id: invoice._id },
      {
        $set: {
          amount: claimed.amount,
          creditApplied: claimed.creditApplied,
          storeOwes: claimed.storeOwes,
          orderIds: claimed.orderIds.map((id) => new Types.ObjectId(id)),
        },
      },
    );
  }

  return {
    invoiceId: String(invoice._id),
    amount: claimed.amount,
    storeOwes: claimed.storeOwes,
    currency: invoice.currency,
    orderCount: claimed.orderIds.length,
    // Passed up so the caller can say what this invoice deliberately left out.
    otherCurrencies: owed.otherCurrencies,
  };
}

/**
 * What an invoice's claim is worth: the commission on exactly the sales that
 * carry its stamp, less as much of the credit as that commission can absorb.
 */
async function billedOnClaim(params: {
  invoiceId: Types.ObjectId;
  vendorId: Types.ObjectId;
  currency: string;
  /** The credit the read offered this bill — never more than it could take. */
  creditAvailable: number;
}): Promise<{
  amount: number;
  creditApplied: number;
  storeOwes: number;
  orderIds: string[];
}> {
  const orders = await Order.find({
    "subOrders.commissionSettlementId": params.invoiceId,
  })
    .select(PAYABLE_ORDER_PROJECTION)
    .lean();
  const refundByOrderId = await fetchRefundTotalsByOrder(
    orders.map((order) => order._id as Types.ObjectId),
  );
  const policy = resolveReturnPolicy(await getSettings());
  const totals = payableInCurrency(
    sumVendorPayable(
      orders,
      params.vendorId,
      refundByOrderId,
      (sub) =>
        String((sub as { commissionSettlementId?: unknown }).commissionSettlementId) ===
        String(params.invoiceId),
      params.currency,
      { billVendorCodShipping: policy.billVendorCodShipping },
    ),
    params.currency,
  );
  const afterPromotions = roundMoney(
    totals.commissionAmount - totals.promotionCredit,
  );
  const creditApplied = roundMoney(
    Math.min(params.creditAvailable, Math.max(0, afterPromotions)),
  );
  return {
    amount: Math.max(0, roundMoney(afterPromotions - creditApplied)),
    creditApplied,
    storeOwes: Math.max(0, roundMoney(-afterPromotions)),
    orderIds: totals.orderIds,
  };
}

/**
 * The invoice was paid — settle every sale it claimed.
 *
 * Scoped by `commissionSettlementId` rather than by the invoice's stored
 * `orderIds`: the stamp on the sub-order is what the owed query reads, so
 * settling exactly the rows carrying this invoice's claim is what keeps the two
 * agreeing. An order listed on the invoice but never actually claimed is left
 * alone rather than settled for free.
 *
 * `paymentId` records WHICH attempt paid, so a later reversal can tell whether
 * to hand the claim back or leave a settlement another attempt bought.
 *
 * The invoice is claimed FIRST, and only while it is still open. Settling used
 * to stamp the sales and then mark the invoice paid if it was not already, so:
 *  - a second payment for the same invoice (the vendor's own gateway attempt
 *    landing after an admin recorded a collection, or two admins at once)
 *    re-stamped every sale with a new date and read as a real settlement —
 *    the vendor was charged twice and nothing said so;
 *  - a payment landing after an admin CANCELLED the invoice flipped it from
 *    cancelled to paid, while its sales, already handed back, could be billed
 *    again.
 * Both now come back as not settled, with the reason, for the caller to flag.
 *
 * Idempotent for the attempt that owns the invoice: re-running it (a crash
 * between the claim and the stamps) finishes stamping without re-dating what
 * was already stamped.
 */
export async function settleCommissionInvoice(input: {
  invoiceId: Types.ObjectId | string;
  paymentId: Types.ObjectId | string;
}): Promise<
  | { settled: true; sales: number }
  | { settled: false; reason: "paid_by_another_payment" | "not_open" }
> {
  await connectDB();

  const settlementId = new Types.ObjectId(String(input.invoiceId));
  const paymentId = new Types.ObjectId(String(input.paymentId));
  const now = new Date();

  const claimed = await CommissionInvoice.findOneAndUpdate(
    { _id: settlementId, status: COMMISSION_INVOICE_STATUS.OPEN },
    {
      $set: {
        status: COMMISSION_INVOICE_STATUS.PAID,
        paymentId,
        paidAt: now,
      },
    },
    { returnDocument: "after" },
  )
    .select("paidAt")
    .lean<{ paidAt?: Date | null } | null>();

  let paidAt = claimed?.paidAt ?? now;
  if (!claimed) {
    const current = await CommissionInvoice.findById(settlementId)
      .select("status paymentId paidAt")
      .lean<{ status?: string; paymentId?: unknown; paidAt?: Date | null } | null>();
    const ownedByThisPayment =
      current?.status === COMMISSION_INVOICE_STATUS.PAID &&
      String(current.paymentId) === String(paymentId);
    if (!ownedByThisPayment) {
      return {
        settled: false,
        reason:
          current?.status === COMMISSION_INVOICE_STATUS.PAID
            ? "paid_by_another_payment"
            : "not_open",
      };
    }
    paidAt = current?.paidAt ?? now;
  }

  // Only the sales not stamped yet: a replay finishes the job without moving
  // the date the settlement actually happened on.
  await Order.updateMany(
    { "subOrders.commissionSettlementId": settlementId },
    { $set: { "subOrders.$[so].commissionSettledAt": paidAt } },
    {
      arrayFilters: [
        {
          "so.commissionSettlementId": settlementId,
          "so.commissionSettledAt": { $exists: false },
        },
      ],
    },
  );
  const sales = await Order.countDocuments({
    "subOrders.commissionSettlementId": settlementId,
  });
  return { settled: true, sales };
}

/**
 * A payout that deducted this bill was paid — settle the bill with it.
 *
 * The money never arrives as a payment of its own: it simply was not sent to
 * the vendor. So the invoice is claimed as paid only while it is still open
 * and still this payout's, and its sales are stamped exactly as a paid invoice
 * stamps them.
 */
export async function settleCommissionInvoiceByPayout(input: {
  invoiceId: Types.ObjectId | string;
  payoutId: Types.ObjectId | string;
  paidAt: Date;
}): Promise<{ settled: boolean; sales: number }> {
  await connectDB();
  const settlementId = new Types.ObjectId(String(input.invoiceId));
  const claimed = await CommissionInvoice.findOneAndUpdate(
    {
      _id: settlementId,
      status: COMMISSION_INVOICE_STATUS.OPEN,
      payoutId: new Types.ObjectId(String(input.payoutId)),
    },
    { $set: { status: COMMISSION_INVOICE_STATUS.PAID, paidAt: input.paidAt } },
    { returnDocument: "after" },
  )
    .select("_id")
    .lean();
  if (!claimed) return { settled: false, sales: 0 };

  await Order.updateMany(
    { "subOrders.commissionSettlementId": settlementId },
    { $set: { "subOrders.$[so].commissionSettledAt": input.paidAt } },
    {
      arrayFilters: [
        {
          "so.commissionSettlementId": settlementId,
          "so.commissionSettledAt": { $exists: false },
        },
      ],
    },
  );
  const sales = await Order.countDocuments({
    "subOrders.commissionSettlementId": settlementId,
  });
  return { settled: true, sales };
}

/**
 * Drop a deduction a payout claimed but never went through with — the payout
 * was abandoned before it existed. Its sales are owed again, and no invoice is
 * left behind for a bill nobody raised.
 */
export async function discardCommissionInvoice(
  invoiceId: Types.ObjectId | string,
): Promise<void> {
  await releaseCommissionInvoice(invoiceId, "cancelled");
  await CommissionInvoice.deleteOne({
    _id: new Types.ObjectId(String(invoiceId)),
    status: COMMISSION_INVOICE_STATUS.CANCELLED,
  });
}

/**
 * Give the claim back — the invoice was cancelled, or its payment reversed.
 *
 * Both stamps are cleared, so the sales return to the owed balance and can be
 * billed again. Leaving `commissionSettledAt` behind after a chargeback would
 * write the debt off permanently on money that came back.
 */
export async function releaseCommissionInvoice(
  invoiceId: Types.ObjectId | string,
  reason: "cancelled" | "reversed",
): Promise<number> {
  await connectDB();

  const settlementId = new Types.ObjectId(String(invoiceId));
  const result = await Order.updateMany(
    { "subOrders.commissionSettlementId": settlementId },
    {
      $unset: {
        "subOrders.$[so].commissionSettlementId": "",
        "subOrders.$[so].commissionSettledAt": "",
        "subOrders.$[so].commissionClaimedAt": "",
      },
    },
    { arrayFilters: [{ "so.commissionSettlementId": settlementId }] },
  );

  await CommissionInvoice.updateOne(
    { _id: settlementId },
    {
      $set: {
        status: COMMISSION_INVOICE_STATUS.CANCELLED,
        // A reversed invoice keeps the attempt that paid it, as history; a
        // cancelled one never had one.
        ...(reason === "cancelled" ? { paymentId: null, paidAt: null } : {}),
      },
    },
  );

  return result.modifiedCount;
}
