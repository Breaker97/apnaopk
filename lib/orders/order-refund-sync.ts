import "server-only";

import type Stripe from "stripe";

import { connectDB } from "@/lib/db";
import { Order } from "@/models/order.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { PAYMENT_STATUS } from "@/config/app.config";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { fromPaystackAmountSubunits } from "@/lib/payments/paystack";
import { fromRazorpayAmountSubunits } from "@/lib/payments/razorpay";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import { postRefundReversalSafely } from "@/lib/finance/post-events";
import { ReturnRequest } from "@/models/return-request.model";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";

/**
 * Keeping Storify's idea of a refund in step with the gateway's.
 *
 * Two things could happen at Stripe that Storify never learned about, and both
 * left the books describing money that had not moved the way they said.
 *
 * A refund issued from the STRIPE DASHBOARD — which is how a support team
 * actually refunds someone at three in the morning — produced no transaction
 * row, no ledger entry and no change to `refundedTotal` here. The order still
 * read as fully paid, so the vendor was still paid out in full for a sale the
 * shopper had already been given their money back for.
 *
 * And a refund can FAIL after the gateway accepts it: a closed account, a bank
 * that rejects the credit. Storify wrote every refund down as succeeded the
 * moment the API returned, so a failure left revenue reversed, the vendor's
 * payable clawed, and a shopper still out of pocket with nothing recording it.
 *
 * Both are handled by identity rather than by arithmetic. The gateway's own
 * refund id is matched against `PaymentTransaction.externalId`, so a refund
 * Storify raised itself is recognised as already recorded and a webhook that
 * arrives twice changes nothing the second time. Comparing amounts instead
 * would race with an in-flight in-app refund and record it a second time.
 *
 * Written once for every gateway rather than per gateway. Stripe, Paystack,
 * Razorpay and PayPal disagree about payload shapes, subunits and event names
 * and about nothing else — so each contributes an adapter that says which
 * order and which refunds, and the money handling below is shared. Pesapal is
 * the exception and needs none of this: its IPN already walks a reversal all
 * the way back through `reversePesapalOrder`.
 */

/** Refund states Stripe considers money on its way out. */
const LIVE_REFUND_STATUSES = new Set(["succeeded", "pending", "requires_action"]);

/** States that mean the money is NOT going back after all. */
const DEAD_REFUND_STATUSES = new Set(["failed", "canceled"]);

/** One refund, as some gateway describes it, reduced to what matters here. */
interface GatewayRefundRecord {
  /** The gateway's own id. What makes recording idempotent. */
  id: string;
  /** Major units, already out of whatever subunit the gateway quoted. */
  amount: number;
  /** Whether the money is on its way back, or has stopped being so. */
  live: boolean;
}

/** How an order is found from a gateway's own identifier. */
type OrderLocator = Record<string, unknown>;

type OrderForRefund = {
  _id: unknown;
  orderNumber: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  paypalCaptureId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  currency?: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  channel?: string;
  posLocationId?: unknown;
  createdAt?: Date;
  refundedTotal?: number;
};

const ORDER_FIELDS =
  "orderNumber paymentMethod paymentStatus paymentId stripePaymentIntentId preorderBalancePaymentIntentId paypalCaptureId razorpayPaymentId paystackTransactionId pesapalConfirmationCode currency subtotal shippingCost tax discount total channel posLocationId createdAt refundedTotal";

/** What the order's payment state becomes once `refunded` totals this much. */
function paymentStatusFor(order: OrderForRefund, refundedTotal: number) {
  const total = Number(order.total || 0);
  if (refundedTotal <= 0.005) return PAYMENT_STATUS.PAID;
  return refundedTotal >= total - 0.01
    ? PAYMENT_STATUS.REFUNDED
    : PAYMENT_STATUS.PARTIALLY_REFUNDED;
}

async function findOrder(
  locator: OrderLocator,
): Promise<OrderForRefund | null> {
  const entries = Object.entries(locator).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return null;

  // Any one of the identifiers a gateway might have given us. They are all
  // unique to a single order, so matching on whichever is present is the same
  // answer as matching on all of them.
  return Order.findOne({
    $or: entries.map(([field, value]) => ({ [field]: value })),
  })
    .select(ORDER_FIELDS)
    .lean<OrderForRefund | null>();
}

/**
 * Record any refund the gateway knows about that Storify does not.
 *
 * Shared by every gateway's webhook. Returns how many rows it had to create,
 * which on a healthy install is always zero — the refunds Storify raised are
 * already there under the same ids.
 */
async function reconcileGatewayOrderRefunds(params: {
  locator: OrderLocator;
  refunds: GatewayRefundRecord[];
  /** What the created rows should say about where they came from. */
  reason?: string;
  /** Who to credit the row to, for the audit trail. */
  createdBy?: string;
}): Promise<number> {
  await connectDB();

  const live = (params.refunds || []).filter(
    (refund) => refund?.live && refund.id && Number(refund.amount) > 0,
  );
  if (live.length === 0) return 0;

  const order = await findOrder(params.locator);
  if (!order) return 0;

  // A refund raised in-app can span two gateway charges — a pre-order's
  // deposit and its balance — while writing ONE row. `metadata.gatewayRefundIds`
  // is where the extra ids live, and without reading it back the second charge's
  // `charge.refunded` webhook would record its half all over again.
  const liveIds = live.map((refund) => refund.id);
  const known = new Set<string>();
  for (const row of await PaymentTransaction.find({
    orderId: order._id,
    type: "refund",
    $or: [
      { externalId: { $in: liveIds } },
      { "metadata.gatewayRefundIds": { $in: liveIds } },
    ],
  })
    .select("externalId metadata")
    .lean<Array<{ externalId?: string; metadata?: { gatewayRefundIds?: unknown } }>>()) {
    if (row.externalId) known.add(String(row.externalId));
    const extra = row.metadata?.gatewayRefundIds;
    if (Array.isArray(extra)) {
      for (const id of extra) known.add(String(id));
    }
  }

  const currency = String(order.currency || "USD");
  let recorded = 0;

  for (const refund of live) {
    if (known.has(refund.id)) continue;
    const amount = Number(refund.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    // Claimed against the order the same way an in-app refund claims it, so a
    // refund issued elsewhere cannot take the total past what was charged.
    const claim = await Order.findOneAndUpdate(
      {
        _id: order._id,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ["$refundedTotal", 0] }, amount] },
            Number(order.total || 0) + 0.01,
          ],
        },
      },
      [
        {
          $set: {
            refundedTotal: { $add: [{ $ifNull: ["$refundedTotal", 0] }, amount] },
          },
        },
      ],
      { new: true },
    )
      .select("refundedTotal")
      .lean<{ refundedTotal?: number } | null>();

    if (!claim) {
      console.error(
        `Gateway refund ${refund.id} exceeds what ${order.orderNumber} was charged; not recorded`,
      );
      continue;
    }

    const nextRefunded = Number(claim.refundedTotal || amount);
    const paymentStatus = paymentStatusFor(order, nextRefunded);
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus } });

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
        total: order.total,
        currency,
        channel: order.channel || "online",
        posLocationId: order.posLocationId
          ? String(order.posLocationId)
          : undefined,
        createdAt: order.createdAt,
      },
      amount,
      // Named so an admin reading the transaction list can tell at a glance
      // that nobody pressed a button in Storify to cause it.
      reason: params.reason || "Refunded from the payment gateway",
      externalRefundId: refund.id,
      gatewayCalled: true,
      createdBy: params.createdBy || "gateway-webhook",
    });

    // Points follow the money, exactly as they do on an in-app refund.
    const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
    await reverseOrderLoyaltyPoints(String(order._id)).catch((error) =>
      console.error("Failed to reverse loyalty points:", error),
    );

    recorded += 1;
  }

  return recorded;
}

/**
 * Stripe's adapter: which order, and which refunds.
 *
 * The charge payload carries only the first page of refunds, and a heavily
 * refunded charge can have more, so they are listed rather than read off the
 * event. One round trip removes the question entirely.
 */
export async function reconcileStripeOrderRefunds(
  charge: Stripe.Charge,
  stripe: Stripe,
): Promise<number> {
  const intentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!intentId) return 0;

  let refunds: Stripe.Refund[] = [];
  try {
    const page = await stripe.refunds.list({ charge: charge.id, limit: 100 });
    refunds = page.data;
  } catch (error) {
    console.error("Failed to list Stripe refunds for", charge.id, error);
    refunds = charge.refunds?.data ?? [];
  }

  const currency = String(charge.currency || "USD");
  return reconcileGatewayOrderRefunds({
    // Either Stripe charge can be the one refunded from the dashboard: a
    // deposit-mode pre-order's balance is its own intent, and looking only at
    // `stripePaymentIntentId` found no order for it at all.
    locator: {
      stripePaymentIntentId: intentId,
      preorderBalancePaymentIntentId: intentId,
    },
    reason: "Refunded from the payment gateway",
    createdBy: "stripe-webhook",
    refunds: refunds.map((refund) => ({
      id: refund.id,
      amount: fromStripeAmount(refund.amount, currency),
      live: LIVE_REFUND_STATUSES.has(String(refund.status || "")),
    })),
  });
}

/**
 * Undo a refund the gateway later rejected.
 *
 * The row is marked failed rather than deleted, and the ledger entries are
 * reversed rather than removed — the refund was a real event on the day it was
 * made, and a set of books that quietly loses a day is worse than one showing
 * the mistake and its correction.
 */
export async function reverseFailedOrderRefund(
  refund: Stripe.Refund,
): Promise<boolean> {
  if (!DEAD_REFUND_STATUSES.has(String(refund.status || ""))) return false;
  await connectDB();

  const txn = await PaymentTransaction.findOne({
    type: "refund",
    status: "succeeded",
    externalId: refund.id,
  })
    .select("orderId grossAmount")
    .lean<{ _id: unknown; orderId: unknown; grossAmount?: number } | null>();
  // Nothing recorded under this id, or it was reversed already. Either way the
  // books already say what the gateway says.
  if (!txn) return false;

  const amount = Number(txn.grossAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const order = await Order.findById(txn.orderId)
    .select(ORDER_FIELDS)
    .lean<OrderForRefund | null>();
  if (!order) return false;

  // Guarded so a webhook delivered twice cannot mark the same row failed twice
  // and take the money off the order's running total more than once.
  const claimed = await PaymentTransaction.findOneAndUpdate(
    { _id: txn._id, status: "succeeded" },
    { $set: { status: "failed" } },
  )
    .select("_id")
    .lean();
  if (!claimed) return false;

  const updated = await Order.findOneAndUpdate(
    { _id: order._id },
    { $inc: { refundedTotal: -amount } },
    { new: true },
  )
    .select("refundedTotal")
    .lean<{ refundedTotal?: number } | null>();

  const nextRefunded = Math.max(0, Number(updated?.refundedTotal || 0));
  await Order.updateOne(
    { _id: order._id },
    { $set: { paymentStatus: paymentStatusFor(order, nextRefunded) } },
  );

  // The charge row carries the running refunded figure the transactions screen
  // reads, and it was incremented when the refund was recorded.
  await PaymentTransaction.updateMany(
    { orderId: order._id, type: "charge" },
    { $inc: { refundedAmount: -amount, netAmount: amount } },
  );

  postRefundReversalSafely({
    orderId: order._id,
    amount,
    refundId: txn._id,
  });

  // The points the refund took off the shopper follow the money back. The
  // reversal helper reads the order's refunded total, which has just gone
  // down, so the same call that removed them restores them.
  const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
  await reverseOrderLoyaltyPoints(String(order._id)).catch((error) =>
    console.error("Failed to restore loyalty points:", error),
  );

  // A return that was marked refunded on the strength of this is not refunded
  // any more. Left alone, its cumulative cap still counted the money — so the
  // admin could not even retry the refund the shopper never received.
  await ReturnRequest.updateMany(
    { "actualRefund.paymentTransactionId": txn._id },
    {
      $set: {
        status: RETURN_STATUS.REFUND_PENDING,
        refundStatus: RETURN_REFUND_STATUS.FAILED,
      },
      $inc: { "actualRefund.amount": -amount },
      $unset: { refundedAt: "", closedAt: "" },
    },
  ).catch((error) =>
    console.error("Failed to reopen the return behind a failed refund:", error),
  );

  console.error(
    `Stripe refund ${refund.id} failed; reversed ${amount} on ${order.orderNumber}`,
  );
  return true;
}

/**
 * What a gateway's refund payload means, in the shared terms above.
 *
 * The mappings are PURE, and separated from the work for the same reason
 * `lib/finance/postings.ts` is separated from `post-events.ts`: what can
 * actually go wrong per gateway is the reading — which field names the order,
 * which id makes recording idempotent, what their status words mean, and
 * whether money is quoted in major units or subunits. None of that needs a
 * database to be wrong in, and none of it should need one to be tested.
 *
 * Null means "nothing here to record", not an error.
 */
interface GatewayRefundReading {
  locator: OrderLocator;
  refunds: GatewayRefundRecord[];
  reason: string;
  createdBy: string;
}

/** Paystack: kobo, and an order found by the transaction reference. */
export function readPaystackRefund(refund: {
  id?: unknown;
  status?: string;
  amount?: number;
  currency?: string;
  transaction_reference?: string;
  transaction?: { id?: unknown; reference?: string } | null;
}): GatewayRefundReading | null {
  const id = String(refund?.id || "");
  if (!id) return null;

  const reference =
    refund.transaction_reference ||
    refund.transaction?.reference ||
    (refund.transaction?.id ? String(refund.transaction.id) : "");
  if (!reference) return null;

  const status = String(refund.status || "").toLowerCase();
  return {
    locator: { paystackTransactionId: reference, paymentId: reference },
    reason: "Refunded from the payment gateway",
    createdBy: "paystack-webhook",
    refunds: [
      {
        id,
        amount: fromPaystackAmountSubunits(
          Number(refund.amount || 0),
          String(refund.currency || "NGN"),
        ),
        // Paystack calls a refund on its way out `pending` or `processing`,
        // and one that arrived `processed`. Everything else has stopped.
        live: ["processed", "pending", "processing"].includes(status),
      },
    ],
  };
}

/** Razorpay: paise, and an order found by the payment being reversed. */
export function readRazorpayRefund(refund: {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  payment_id?: string;
}): GatewayRefundReading | null {
  const id = String(refund?.id || "");
  const paymentId = String(refund?.payment_id || "");
  if (!id || !paymentId) return null;

  const status = String(refund.status || "").toLowerCase();
  return {
    locator: { razorpayPaymentId: paymentId, paymentId },
    reason: "Refunded from the payment gateway",
    createdBy: "razorpay-webhook",
    refunds: [
      {
        id,
        amount: fromRazorpayAmountSubunits(
          Number(refund.amount || 0),
          String(refund.currency || "INR"),
        ),
        // `created` is accepted and not yet settled; `processed` has settled.
        // `failed` is the case the reversal path exists for.
        live: ["processed", "created", "pending"].includes(status),
      },
    ],
  };
}

/** PayPal: major units, and an order found by the capture being reversed. */
export function readPayPalRefund(refund: {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string } | null;
  links?: Array<{ rel?: string; href?: string }> | null;
  capture_id?: string;
}): GatewayRefundReading | null {
  const id = String(refund?.id || "");
  if (!id) return null;

  // PayPal does not put the capture id in the body of every refund event, but
  // it always links back to it. `up` is the capture the refund came from.
  const linked = (refund.links || []).find(
    (link) => String(link?.rel || "").toLowerCase() === "up",
  )?.href;
  const captureId =
    refund.capture_id ||
    (linked ? linked.split("/").filter(Boolean).pop() : "") ||
    "";
  if (!captureId) return null;

  const status = String(refund.status || "").toUpperCase();
  return {
    locator: { paypalCaptureId: captureId },
    reason: "Refunded from the payment gateway",
    createdBy: "paypal-webhook",
    refunds: [
      {
        id,
        // Quoted in major units, so there is no subunit arithmetic to get
        // wrong — which is its own small mercy.
        amount: Number(refund.amount?.value || 0),
        // `COMPLETED` went through, `PENDING` is still settling. `CANCELLED`
        // and `FAILED` are what the reversal path exists for.
        live: ["COMPLETED", "PENDING"].includes(status),
      },
    ],
  };
}

/** Apply a reading, or do nothing when there was nothing to read. */
export async function reconcileGatewayRefundReading(
  reading: GatewayRefundReading | null,
): Promise<number> {
  return reading ? reconcileGatewayOrderRefunds(reading) : 0;
}

/**
 * A refund any gateway has told us did not go through.
 *
 * Addressed by the gateway's own refund id, which is all the unwind ever
 * needed — the row it finds carries the order, the amount and the split.
 */
export async function reverseFailedGatewayRefund(
  externalId: string,
): Promise<boolean> {
  return reverseFailedOrderRefund({
    id: externalId,
    status: "failed",
  } as Stripe.Refund);
}
