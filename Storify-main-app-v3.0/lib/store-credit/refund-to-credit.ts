import "server-only";

import { Types } from "mongoose";
import { Order, User } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import { scaleRefundAllocation, type RefundAllocationShare } from "@/lib/returns/refund-allocation";
import { issueStoreCredit } from "@/lib/store-credit/store-credit";
import { resolveRefundPayer } from "@/lib/returns/refund-settlement";
import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * Refunding to store credit (R8): the part of a refund the store gives as
 * credit instead of sending back.
 *
 * The sale is reversed exactly as any refund reverses it — same split across
 * sellers, same commission back — so a seller cannot tell a refund to credit
 * from one to the card. The difference is where it goes: nothing leaves a
 * cash account, and the shopper is owed it as credit (`store_credit_payable`,
 * see `refundPostings`). The refund row says so (`metadata.storeCredit`).
 */

type OrderLike = Parameters<typeof createRefundTransaction>[0]["order"] & {
  customerId?: unknown;
};

/** Why a refund cannot go to store credit, or null when it can. */
export async function storeCreditRefundProblem(params: {
  order: { customerId?: unknown; guestEmail?: string | null };
  /** Who holds the money: a seller who took the cash cannot be refunded as credit. */
  refundPayer?: string | null;
}): Promise<string | null> {
  // A populated customer is read for its id.
  const customer = params.order.customerId as { _id?: unknown } | string | null | undefined;
  const customerId = String(
    (customer && typeof customer === "object" && "_id" in customer ? customer._id : customer) || "",
  );
  if (!Types.ObjectId.isValid(customerId)) {
    return "Store credit needs a customer account. This order was placed as a guest, so refund it to the original payment.";
  }
  const account = await User.exists({ _id: customerId });
  if (!account) {
    return "Store credit needs a customer account. This order was placed as a guest, so refund it to the original payment.";
  }
  if (String(params.refundPayer || "") === "vendor") {
    return "The seller collected this order's money, so it can't be refunded as store credit. The seller refunds it.";
  }
  return null;
}

/**
 * `storeCreditRefundProblem` for a whole order: refused where any seller took
 * the cash at their own door. The store's own consignments are the store's,
 * however their cash was collected.
 */
export async function orderStoreCreditRefundProblem(
  order: Parameters<typeof resolveRefundPayer>[0]["order"] & {
    customerId?: unknown;
    guestEmail?: string | null;
  },
): Promise<string | null> {
  const { getDefaultVendorIds } = await import("@/lib/finance/post-events");
  const ownVendorIds = await getDefaultVendorIds().catch(() => new Set<string>());
  const sellerHoldsCash = (order.subOrders || []).some(
    (sub) =>
      Boolean(sub?.vendorId) &&
      !ownVendorIds.has(String(sub?.vendorId)) &&
      resolveRefundPayer({ order, vendorId: sub?.vendorId }) === "vendor",
  );
  return storeCreditRefundProblem({
    order,
    refundPayer: sellerHoldsCash ? "vendor" : "platform",
  });
}

/**
 * Record the store-credit part of a refund: its refund row, and the credit.
 * Idempotent through the row: a retry finds the credit already given.
 */
export async function refundToStoreCredit(params: {
  order: OrderLike;
  amount: number;
  /** The refund's split, for the whole refund; scaled to this part. */
  allocation?: RefundAllocationShare[] | null;
  /** The whole refund this part belongs to, when it was split. */
  wholeAmount?: number;
  /**
   * `order_refund_restore` when it is the credit the order was paid with going
   * back — see `splitRefundCreditFirst`.
   */
  source: "return_refund" | "order_refund" | "order_refund_restore";
  /** The consignments a cancellation's refund belongs to — see `createRefundTransaction`. */
  consignmentIds?: ReadonlyArray<unknown> | null;
  returnId?: unknown;
  expiresAt?: Date | null;
  reason?: string;
  createdBy: string;
  /** More facts for the refund row — the units it paid for. */
  metadata?: Record<string, unknown>;
}): Promise<{ refundTransactionId: string; lotId: string }> {
  const currency = String(params.order.currency || "USD").toUpperCase();
  const amount = quantizeToCurrency(Math.max(0, Number(params.amount) || 0), currency);
  if (!(amount > 0)) throw new ValidationError("Store credit must be more than 0");
  const customer = params.order.customerId as { _id?: unknown } | string | null | undefined;
  const customerId = String(
    (customer && typeof customer === "object" && "_id" in customer ? customer._id : customer) || "",
  );
  if (!Types.ObjectId.isValid(customerId)) {
    throw new ValidationError("Store credit needs a customer account");
  }
  const allocation =
    params.allocation && params.wholeAmount && params.wholeAmount > amount
      ? scaleRefundAllocation(params.allocation, amount, currency)
      : params.allocation ?? null;

  const row = await createRefundTransaction({
    order: params.order,
    amount,
    reason: params.reason || "Refunded as store credit",
    createdBy: params.createdBy,
    gatewayCalled: false,
    allocation,
    // Nothing to send: it is on the shopper's account the moment it is given.
    settlement: "not_required",
    notifySettlement: false,
    source: "store-credit-refund",
    metadata: { ...(params.metadata || {}), storeCredit: true },
    consignmentIds: params.consignmentIds,
  });
  if (!row) throw new ValidationError("The store credit refund could not be recorded");
  // What the order has given back as credit, which is what decides how much
  // of a later refund can still go back to the card — see `order-credit.ts`.
  await Order.updateOne(
    { _id: params.order._id },
    { $inc: { "storeCredit.refunded": amount } },
  );

  const lot = await issueStoreCredit({
    customerId,
    currency,
    amount,
    expiresAt: params.expiresAt ?? null,
    source: params.source,
    orderId: String(params.order._id),
    returnId: params.returnId ? String(params.returnId) : undefined,
    paymentTransactionId: String(row._id),
    note: params.reason,
    createdBy: params.createdBy,
    idempotencyKey: `refund:${String(row._id)}`,
  });
  return { refundTransactionId: String(row._id), lotId: String(lot._id) };
}
