import { Order, PaymentTransaction } from "@/models";
import { feeInChargeCurrency } from "@/lib/payments/gateway-fee";
import { quantizeToCurrency } from "@/lib/intl/money";
import type { RefundAllocationShare } from "@/lib/returns/refund-allocation";
import {
  postOrderPaidSafely,
  postRefundSafely,
  resolveRefundAllocation,
} from "@/lib/finance/post-events";

type OrderLike = {
  _id: string;
  orderNumber: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  paypalCaptureId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  iotecTransactionId?: string;
  orangeMoneyTxnId?: string;
  mtnMomoTransactionId?: string;
  mtnMomoReferenceId?: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  /** Pre-order balance not collected yet — subtracted from the recorded gross
   *  while the order is partially_paid so the ledger reflects money actually
   *  received, not the full order value. */
  preorderOutstandingAmount?: number;
  /** What the gateway kept, as it reported it. Absent = not reported. */
  paymentFee?: number;
  paymentFeeCurrency?: string;
  paymentFeeRate?: number;
  currency?: string;
  channel?: string;
  posLocationId?: string;
  paymentMetadata?: Record<string, unknown>;
  createdAt?: Date | string;
};

export function getPaymentProviderFromOrder(order: OrderLike): string {
  const method = String(order.paymentMethod || "").toLowerCase();
  const channel = String(order.channel || "").toLowerCase();

  if (channel === "pos") {
    if (method === "cash") return "pos_cash";
    if (method === "card") return "pos_card";
    if (method === "manual") return "pos_manual";
    return method ? `pos_${method}` : "pos";
  }

  if (method === "card") return "stripe";
  if (method === "paypal") return "paypal";
  if (method === "razorpay") return "razorpay";
  if (method === "paystack") return "paystack";
  if (method === "pesapal") return "pesapal";
  if (method === "iotec") return "iotec";
  if (method === "orange_money") return "orange_money";
  if (method === "mtn_momo") return "mtn_momo";
  if (method === "cod") return "cod";
  if (method === "manual") return "manual";
  return method || "manual";
}

function getChargeExternalId(order: OrderLike): string | undefined {
  return (
    order.stripePaymentIntentId ||
    order.paypalCaptureId ||
    order.razorpayPaymentId ||
    order.paystackTransactionId ||
    order.pesapalConfirmationCode ||
    order.iotecTransactionId ||
    order.orangeMoneyTxnId ||
    // financialTransactionId when the payment succeeded; the request UUID is
    // the fallback so a pending charge row is still traceable to MTN.
    order.mtnMomoTransactionId ||
    order.mtnMomoReferenceId ||
    order.paymentId ||
    undefined
  );
}

function getCurrency(order: OrderLike): string {
  const currency = String(order.currency || "").trim().toUpperCase();
  return currency || "USD";
}

function buildChargePayload(order: OrderLike, status: "pending" | "succeeded") {
  const total = Number(order.total || 0);
  // A partially_paid order collected only the deposit; recording the full
  // total would overstate revenue until the balance arrives.
  const gross =
    String(order.paymentStatus || "") === "partially_paid"
      ? Math.max(0, total - Number(order.preorderOutstandingAmount || 0))
      : total;
  const externalId = getChargeExternalId(order);
  const currency = getCurrency(order);
  // Only a fee expressible in the ORDER's currency may be netted off its total.
  // Stripe settles in the account's balance currency, so a EUR charge on a USD
  // account carries a USD fee — but Stripe also states the rate it used, and
  // with that rate the fee CAN be stated honestly here. Without one it is left
  // out of `netAmount` and kept in metadata, where a report can show it as
  // unconverted rather than silently treating dollars as euros.
  const feeCurrency = String(order.paymentFeeCurrency || "")
    .trim()
    .toUpperCase();
  const reportedFee = Number(order.paymentFee);
  const hasFee = Number.isFinite(reportedFee) && reportedFee >= 0;
  const convertedFee = hasFee
    ? feeInChargeCurrency({
        fee: reportedFee,
        feeCurrency,
        chargeCurrency: currency,
        rate: order.paymentFeeRate,
      })
    : undefined;
  const netableFee =
    convertedFee === undefined ? 0 : quantizeToCurrency(convertedFee, currency);

  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    type: "charge",
    status,
    provider: getPaymentProviderFromOrder(order),
    paymentMethod: order.paymentMethod || "manual",
    currency,
    grossAmount: gross,
    feeAmount: netableFee,
    netAmount: gross - netableFee,
    refundedAmount: 0,
    externalId,
    metadata: {
      subtotal: Number(order.subtotal || 0),
      shippingCost: Number(order.shippingCost || 0),
      tax: Number(order.tax || 0),
      discount: Number(order.discount || 0),
      channel: order.channel || "online",
      posLocationId: order.posLocationId,
      source: "order-sync",
      ...(hasFee
        ? {
            gatewayFee: reportedFee,
            gatewayFeeCurrency: feeCurrency || currency,
            ...(order.paymentFeeRate
              ? { gatewayFeeRate: order.paymentFeeRate }
              : {}),
            // Flagged rather than hidden: a fee that could not be stated in the
            // order's currency is missing from `netAmount`, and a report that
            // does not know that would present a net figure as complete.
            ...(convertedFee === undefined
              ? { gatewayFeeUnconverted: true }
              : {}),
          }
        : {}),
      ...(order.paymentMetadata || {}),
    },
    createdAt: order.createdAt ? new Date(order.createdAt) : undefined,
  };
}

export async function ensureChargeTransaction(order: OrderLike) {
  const status = String(order.paymentStatus || "");
  // partially_paid included: a captured pre-order deposit is real money and
  // must appear in the ledger (previously it was never recorded at all).
  if (
    status !== "paid" &&
    status !== "partially_paid" &&
    status !== "partially_refunded" &&
    status !== "refunded"
  ) {
    return;
  }

  const existing = await PaymentTransaction.findOne({
    orderId: order._id,
    type: "charge",
  })
    .select("_id status")
    .lean();

  const payload = buildChargePayload(order, "succeeded");

  if (existing) {
    // Pipeline update so re-syncing an already-refund-adjusted charge doesn't
    // wipe those adjustments: netAmount is recomputed as gross − refundedAmount
    // (a plain $set of netAmount=gross erased prior refunds), and the original
    // currency label is kept — re-labelling historical rows to the CURRENT
    // store currency corrupted reports whenever the default currency changed.
    await PaymentTransaction.updateOne(
      { _id: existing._id },
      [
        {
          $set: {
            status: "succeeded",
            provider: { $literal: payload.provider },
            paymentMethod: { $literal: payload.paymentMethod },
            currency: { $ifNull: ["$currency", payload.currency] },
            grossAmount: payload.grossAmount,
            feeAmount: payload.feeAmount,
            netAmount: {
              $subtract: [
                payload.grossAmount - payload.feeAmount,
                { $ifNull: ["$refundedAmount", 0] },
              ],
            },
            externalId: { $literal: payload.externalId ?? null },
            metadata: { $literal: payload.metadata },
          },
        },
      ],
    );
    if (existing.status !== "succeeded") {
      // Pending → succeeded is the moment the money is real. Re-syncing an
      // already-succeeded charge posts nothing new: the keys collide.
      postOrderPaidSafely(order._id);
      const { notifyAdminsPaymentReceived } = await import("@/lib/notifications/notifications");
      await notifyAdminsPaymentReceived({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        amount: payload.grossAmount,
        currency: payload.currency,
        paymentMethod: payload.paymentMethod,
      });
    }
    return;
  }

  await PaymentTransaction.create(payload);
  // The ledger follows the same choke point the transaction row does, so every
  // gateway, the POS and the manual paths all post without knowing they do.
  postOrderPaidSafely(order._id);
  const { notifyAdminsPaymentReceived } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentReceived({
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    amount: payload.grossAmount,
    currency: payload.currency,
    paymentMethod: payload.paymentMethod,
  });
}

export async function ensurePendingChargeTransaction(order: OrderLike) {
  const status = String(order.paymentStatus || "");
  if (status !== "pending" && status !== "partially_paid") return;

  const existing = await PaymentTransaction.findOne({
    orderId: order._id,
    type: "charge",
  })
    .select("_id")
    .lean();

  if (existing) return;

  await PaymentTransaction.create(buildChargePayload(order, "pending"));
}

export async function createRefundTransaction(params: {
  order: OrderLike;
  amount: number;
  reason?: string;
  createdBy?: string;
  /** Refund identifier returned by the payment gateway, when applicable. */
  externalRefundId?: string;
  /**
   * Every gateway refund behind this row, when the money had to come back
   * from more than one charge (a pre-order's deposit AND its balance).
   * Recorded so the gateway's own refund webhook recognises all of them as
   * already known and does not write the extra ones a second time.
   */
  externalRefundIds?: string[];
  /** Whether the refund was issued automatically via the gateway. */
  gatewayCalled?: boolean;
  /**
   * What this refund was made of, per consignment — see
   * `lib/refund-allocation.ts`. Passed when a return knows; an order-level
   * refund passes nothing and the split is worked out from what earlier
   * refunds left behind.
   */
  allocation?: RefundAllocationShare[] | null;
}) {
  const safeAmount = Math.max(0, Number(params.amount || 0));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return null;

  const gross = Number(params.order.total || 0);
  const chargeExternalId = getChargeExternalId(params.order);

  // Serialize the split per order. `refundedTotal` already stops two refunds
  // exceeding the order between them, but the amount is not the only thing
  // being decided here: resolving the split reads the refunds already
  // recorded, and two that read that list at the same moment would each treat
  // the other's share as still unreversed and both claim it. The claim covers
  // resolve-and-write, and self-expires so a crashed request cannot wedge an
  // order's refunds shut.
  const lockStaleBefore = new Date(Date.now() - 15_000);
  const lock = await Order.findOneAndUpdate(
    {
      _id: params.order._id,
      $or: [
        { refundLockAt: null },
        { refundLockAt: { $exists: false } },
        { refundLockAt: { $lt: lockStaleBefore } },
      ],
    },
    { $set: { refundLockAt: new Date() } },
  )
    .select("_id")
    .lean()
    .catch((error) => {
      // A lock that cannot be taken must not block a refund the gateway has
      // already paid out. Losing it costs the split, not the money.
      console.error("Failed to claim refund lock:", error);
      return null;
    });

  let allocation: Awaited<ReturnType<typeof resolveRefundAllocation>> = null;
  try {
    // Resolved BEFORE the row is written, so "earlier refunds" means earlier
    // than this one. Every refund records its own split now — a refund that
    // names no items is prorated over what is LEFT of the order rather than
    // over the whole of it, which is what stopped a delivery refund from
    // reversing a slice of goods that had already been handed back.
    allocation = await resolveRefundAllocation({
      orderId: params.order._id,
      amount: safeAmount,
      supplied: params.allocation,
    });
  } catch (error) {
    // Never block a refund that has already left the gateway. Without a split
    // the ledger falls back to prorating, exactly as it did before.
    console.error("Failed to resolve refund allocation:", error);
  }

  const txn = await PaymentTransaction.create({
    orderId: params.order._id,
    orderNumber: params.order.orderNumber,
    type: "refund",
    status: "succeeded",
    provider: getPaymentProviderFromOrder(params.order),
    paymentMethod: params.order.paymentMethod || "manual",
    currency: getCurrency(params.order),
    grossAmount: safeAmount,
    feeAmount: 0,
    netAmount: -safeAmount,
    refundedAmount: safeAmount,
    externalId: params.externalRefundId || chargeExternalId,
    note: params.reason,
    // Written before the ledger is asked to post, because the ledger reads it
    // back off this row rather than being handed it — one stored fact, so a
    // replay of history cannot post a different split from the original, and
    // the payout arithmetic cannot reach a different answer from the ledger.
    refundAllocation:
      allocation && allocation.length > 0 ? allocation : undefined,
    metadata: {
      source: params.gatewayCalled === false ? "admin-refund-manual" : "admin-refund",
      channel: params.order.channel || "online",
      posLocationId: params.order.posLocationId,
      orderGrossAmount: gross,
      gatewayCalled: params.gatewayCalled !== false,
      chargeExternalId,
      gatewayRefundId: params.externalRefundId,
      ...(params.externalRefundIds && params.externalRefundIds.length > 1
        ? { gatewayRefundIds: params.externalRefundIds }
        : {}),
    },
    createdBy: params.createdBy,
  });

  await PaymentTransaction.updateMany(
    {
      orderId: params.order._id,
      type: "charge",
    },
    {
      $inc: { refundedAmount: safeAmount, netAmount: -safeAmount },
    },
  );

  // Released only now: the split is only safe once the row carrying it exists,
  // because that row is what the next refund reads as history.
  if (lock) {
    await Order.updateOne(
      { _id: params.order._id },
      { $unset: { refundLockAt: "" } },
    ).catch((error) => console.error("Failed to release refund lock:", error));
  }

  // Keyed on the refund row, so two refunds of the same amount on one order
  // stay two entries rather than colliding into one.
  postRefundSafely({
    orderId: params.order._id,
    amount: safeAmount,
    refundId: txn?._id,
  });

  return txn;
}
