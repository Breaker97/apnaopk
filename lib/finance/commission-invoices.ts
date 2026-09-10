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
  const creditApplied = roundMoney(Math.min(credit, grossOwed));

  return {
    currency: wanted,
    // Only the commission column is meaningful — `netAmount` is what the
    // platform would owe the vendor, and on these sales it owes them nothing.
    amount: roundMoney(grossOwed - creditApplied),
    creditApplied,
    grossOwed,
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
}): Promise<{
  invoiceId: string;
  amount: number;
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
  if (owed.amount <= 0 || owed.orderIds.length === 0) return null;

  const vendorObjectId = new Types.ObjectId(input.vendorId);
  const orderObjectIds = owed.orderIds.map((id) => new Types.ObjectId(id));

  const invoice = await CommissionInvoice.create({
    vendorId: vendorObjectId,
    orderIds: orderObjectIds,
    amount: owed.amount,
    currency: input.currency.toUpperCase(),
    status: COMMISSION_INVOICE_STATUS.OPEN,
    createdBy: input.userId,
    note: input.note?.trim() || null,
  });

  const claim = await Order.updateMany(
    { _id: { $in: orderObjectIds } },
    { $set: { "subOrders.$[so].commissionSettlementId": invoice._id } },
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

  return {
    invoiceId: String(invoice._id),
    amount: owed.amount,
    currency: invoice.currency,
    orderCount: owed.orderCount,
    // Passed up so the caller can say what this invoice deliberately left out.
    otherCurrencies: owed.otherCurrencies,
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
 * Idempotent: re-running re-stamps already-settled rows with the same value.
 */
export async function settleCommissionInvoice(input: {
  invoiceId: Types.ObjectId | string;
  paymentId: Types.ObjectId | string;
}): Promise<number> {
  await connectDB();

  const settlementId = new Types.ObjectId(String(input.invoiceId));
  const paidAt = new Date();

  const result = await Order.updateMany(
    { "subOrders.commissionSettlementId": settlementId },
    { $set: { "subOrders.$[so].commissionSettledAt": paidAt } },
    { arrayFilters: [{ "so.commissionSettlementId": settlementId }] },
  );

  // Guarded so a replayed webhook cannot re-attribute an invoice to a second
  // attempt — the first one to land owns the settlement.
  await CommissionInvoice.updateOne(
    { _id: settlementId, status: { $ne: COMMISSION_INVOICE_STATUS.PAID } },
    {
      $set: {
        status: COMMISSION_INVOICE_STATUS.PAID,
        paymentId: new Types.ObjectId(String(input.paymentId)),
        paidAt,
      },
    },
  );

  return result.modifiedCount;
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
