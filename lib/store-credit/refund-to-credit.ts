import "server-only";

import { Types } from "mongoose";
import { Order, PaymentTransaction, User } from "@/models";
import { StoreCreditTransaction } from "@/models/store-credit.model";
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

/** The credit lot a refund row's grant is keyed on. */
const grantKey = (rowId: unknown) => `refund:${String(rowId)}`;

/**
 * Take back a refund row whose credit could not be given: marked failed, as a
 * gateway's refused refund is, so the order no longer reads as having given
 * that credit back. Never throws — the caller is already reporting the
 * failure that brought it here, and says nothing of this one except to the
 * admins, who are the only ones who can finish it.
 */
async function voidUngrantedRefundRow(params: {
  rowId: unknown;
  orderId: unknown;
  orderNumber?: string;
  amount: number;
  currency: string;
  counted: boolean;
  why: string;
}): Promise<void> {
  try {
    const claimed = await PaymentTransaction.findOneAndUpdate(
      { _id: params.rowId, type: "refund", status: "succeeded" },
      {
        $set: {
          status: "failed",
          "metadata.reversedAt": new Date(),
          "metadata.reversedReason": params.why,
        },
      },
    )
      .select("_id")
      .lean();
    if (claimed && params.counted) {
      await Order.updateOne(
        { _id: params.orderId },
        { $inc: { "storeCredit.refunded": -params.amount } },
      );
    }
  } catch (voidError) {
    console.error("Failed to void a store credit refund whose credit was not given:", voidError);
    await announceUnsettledRefundRow(params, "the record could not be taken back");
  }
}

/** Tell the admins about a refund row nobody could settle: only they can finish it. */
async function announceUnsettledRefundRow(
  params: { rowId: unknown; orderId: unknown; orderNumber?: string; amount: number; currency: string; why: string },
  problem: string,
): Promise<void> {
  const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentAnomaly({
    title: "A store credit refund may not have been given",
    message: `A refund of ${params.amount} ${params.currency} on order ${params.orderNumber || String(params.orderId)} was recorded as store credit, but giving the shopper the credit failed (${params.why}) and ${problem}. Check the shopper's store credit for refund row ${String(params.rowId)}: if they were not given it, mark that refund failed by hand, or give the credit.`,
  }).catch((error) => console.error("Failed to announce an unsettled store credit refund:", error));
}

/**
 * Record the store-credit part of a refund: its refund row, and the credit.
 *
 * The row says the shopper has been paid, so it stands only once the credit is
 * really on their account. The credit is idempotent on the row, which is why a
 * failed grant is simply tried again before anything is given up; and when it
 * cannot be given, the row is voided and the failure thrown, so the caller
 * hands back its own claim and the refund can be tried afresh. The ledger is
 * told last, so a voided row never reached it.
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
    postToLedger: false,
    source: "store-credit-refund",
    metadata: { ...(params.metadata || {}), storeCredit: true },
    consignmentIds: params.consignmentIds,
  });
  if (!row) throw new ValidationError("The store credit refund could not be recorded");

  const key = grantKey(row._id);
  let counted = false;
  let lot: { _id: unknown };
  try {
    // What the order has given back as credit, which is what decides how much
    // of a later refund can still go back to the card — see `order-credit.ts`.
    await Order.updateOne(
      { _id: params.order._id },
      { $inc: { "storeCredit.refunded": amount } },
    );
    counted = true;
    lot = await grantWithRetry({
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
      idempotencyKey: key,
    });
  } catch (error) {
    const unsettled = {
      rowId: row._id,
      orderId: params.order._id,
      orderNumber: params.order.orderNumber,
      amount,
      currency,
      why: error instanceof Error ? error.message : "The credit could not be given",
    };
    // The grant may have landed even though the call failed after writing it
    // (the balance refresh is the step after): then the shopper has the
    // credit, and taking the row back would leave it with no refund behind it.
    // `undefined`: the lookup failed too, so nobody can say — the row is left
    // as it is, and the admins are told.
    let given: { _id: unknown } | null | undefined;
    try {
      given = await StoreCreditTransaction.findOne({ idempotencyKey: key })
        .select("_id")
        .lean<{ _id: unknown } | null>();
    } catch {
      given = undefined;
    }
    if (given === null) {
      await voidUngrantedRefundRow({ ...unsettled, counted });
      throw error;
    }
    if (given === undefined) {
      await announceUnsettledRefundRow(unsettled, "it could not be checked whether the credit was given");
      throw error;
    }
    console.error("Store credit was given, but the call that gave it failed afterwards:", error);
    lot = given;
  }

  // Booked now that the shopper has it. A crash before this line leaves a
  // refund row the ledger sweep books by itself.
  const { postRefundSafely } = await import("@/lib/finance/post-events");
  postRefundSafely({ orderId: params.order._id, amount, refundId: row._id });
  return { refundTransactionId: String(row._id), lotId: String(lot._id) };
}

/**
 * `issueStoreCredit`, tried again when the database drops a write. Safe to
 * repeat: the grant is keyed, so a second call can only find the first.
 * A refusal (a bad amount, an expiry in the past) is not retried.
 */
async function grantWithRetry(
  params: Parameters<typeof issueStoreCredit>[0],
): Promise<{ _id: unknown }> {
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await issueStoreCredit(params);
    } catch (error) {
      if (error instanceof ValidationError || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}
