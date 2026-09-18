import "server-only";

import type Stripe from "stripe";

import { connectDB } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import type { RefundAllocationShare } from "@/lib/returns/refund-allocation";
import { Order } from "@/models/order.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { PAYMENT_STATUS } from "@/config/app.config";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { fromPaystackAmountSubunits } from "@/lib/payments/paystack";
import { fromRazorpayAmountSubunits } from "@/lib/payments/razorpay";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import { PAYPAL_BALANCE_REFERENCE_PREFIX } from "@/lib/payments/preorder-balance-reference";
import { postRefundReversalSafely } from "@/lib/finance/post-events";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { hasUncollectedPreorderBalance } from "@/lib/orders/order-payment-status";
import {
  REFUND_IN_FLIGHT_FIELD,
  REFUND_IN_FLIGHT_WINDOW_MS,
  RefundInFlightError,
  isRefundInFlight,
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";
import {
  DISPUTE_MONEY_EPSILON,
  PAYSTACK_LIVE_REFUND_STATUSES,
  disputeNotices,
  paystackRefundDisputeId,
  planDisputeSettlement,
  type DisputeMoneyRow,
  type GatewayDisputeReading,
  type PaystackRefundLike,
} from "@/lib/orders/dispute-readings";
import {
  DISPUTE_GATEWAY_LABEL,
  DISPUTE_RESPONSE_PLACE,
  disputeKey,
  type DisputeGateway,
} from "@/lib/payments/dispute-gateways";
import { createSystemAuditContext } from "@/lib/audit";
import {
  auditOrderChargebackReturned,
  auditOrderRefunded,
} from "@/lib/orders/audit-order";
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
 *
 * Chargebacks come through here too, because to the books they are refunds the
 * store did not choose: the shopper's bank took the money back. What makes
 * them different is that the same money is usually reported twice — as the
 * dispute, and as the gateway's own movement of it (a PayPal capture
 * reversal, a Paystack refund raised for an accepted chargeback) — so a
 * chargeback is matched to whatever already stands for its dispute before
 * anything is recorded. See `applyGatewayDispute`.
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
  /**
   * Set when this money was taken back — by a dispute, or by the shopper's
   * bank — rather than sent as a refund. It is never paired with a refund an
   * admin is waiting to send; it is matched to what already stands for its
   * dispute instead.
   */
  chargeback?: { gateway: DisputeGateway; disputeId?: string };
  /** What its row should say, where that differs from the reading's reason. */
  reason?: string;
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
  refundInFlightAt?: Date | null;
  status?: string;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  subOrders?: Array<{
    status?: string;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

/**
 * Methods whose refunds a gateway webhook reports back, so a refund issued in
 * that gateway's dashboard reaches the books on its own.
 */
export function refundReconciledByWebhook(
  paymentMethod: string | null | undefined,
): boolean {
  return ["card", "stripe", "paypal", "paystack", "razorpay"].includes(
    String(paymentMethod || "").toLowerCase(),
  );
}

/**
 * Pair a gateway refund nobody recorded under its id with a row that is
 * waiting for exactly that money — one recorded by hand for a dashboard
 * refund, or a failed leg an admin was told to re-issue from the dashboard.
 *
 * Both used to be counted twice: the row already stood for the amount, and the
 * webhook, seeing an id it did not know, wrote a second refund for it. The
 * pairing is one conditional write, so two deliveries of the same refund
 * cannot both take the same waiting amount.
 */
async function pairWithAwaitingRefund(
  orderId: unknown,
  refund: GatewayRefundRecord,
): Promise<boolean> {
  const amount = Number(refund.amount);
  const candidates = await PaymentTransaction.find({
    orderId,
    type: "refund",
    status: "succeeded",
    "metadata.awaitingGatewayRefunds.amount": {
      $gte: amount - 0.005,
      $lte: amount + 0.005,
    },
  })
    .select("createdAt metadata.awaitingGatewayRefunds")
    .lean<
      Array<{
        _id: unknown;
        createdAt?: Date;
        metadata?: { awaitingGatewayRefunds?: Array<{ key?: string; amount?: number }> };
      }>
    >();

  // Oldest first, so the refund that has waited longest is the one paired.
  candidates.sort(
    (a, b) =>
      new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
  for (const row of candidates) {
    const waiting = (row.metadata?.awaitingGatewayRefunds || []).find(
      (entry) => Math.abs(Number(entry.amount) - amount) <= 0.005,
    );
    if (!waiting?.key) continue;
    const paired = await PaymentTransaction.updateOne(
      { _id: row._id, "metadata.awaitingGatewayRefunds.key": waiting.key },
      {
        $pull: { "metadata.awaitingGatewayRefunds": { key: waiting.key } },
        $addToSet: { "metadata.gatewayRefundIds": refund.id },
      },
    );
    if (paired.modifiedCount) return true;
  }
  return false;
}

// The pre-order fields are what `hasUncollectedPreorderBalance` reads. Left out
// of the projection they read as "nothing outstanding", which is the answer
// that lets a refund mark a still-owing order paid.
const ORDER_FIELDS =
  "orderNumber paymentMethod paymentStatus paymentId stripePaymentIntentId preorderBalancePaymentIntentId paypalCaptureId razorpayPaymentId paystackTransactionId pesapalConfirmationCode currency subtotal shippingCost tax discount total channel posLocationId createdAt refundedTotal refundInFlightAt status preorderOutstandingAmount preorderBalancePaidAt subOrders.status subOrders.items.preorderOutstandingAmount";

/** What the order's payment state becomes once `refunded` totals this much. */
function paymentStatusFor(order: OrderForRefund, refundedTotal: number) {
  // Not while a live pre-order is still waiting on its balance. A refund made
  // from the gateway's dashboard collects nothing, and neither does undoing
  // one that failed — yet `paid` and both refunded states read as settled to
  // every balance path, so the balance would never be asked for and the goods
  // would be released without it.
  if (hasUncollectedPreorderBalance(order)) {
    return PAYMENT_STATUS.PARTIALLY_PAID;
  }
  const total = Number(order.total || 0);
  if (refundedTotal <= 0.005) return PAYMENT_STATUS.PAID;
  return refundedTotal >= total - 0.01
    ? PAYMENT_STATUS.REFUNDED
    : PAYMENT_STATUS.PARTIALLY_REFUNDED;
}

/**
 * Write that state. Part-paid is guarded, because it rests on the balance not
 * having arrived when the order was read: a balance paid in between has
 * already marked the order paid, and part-paid over that would ask for the
 * balance again.
 */
async function writePaymentStatus(
  order: OrderForRefund,
  paymentStatus: string,
) {
  await Order.updateOne(
    paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID
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

/** Which dispute a row's money belongs to. */
function disputeMeta(gateway: DisputeGateway, disputeId: string) {
  const id = String(disputeId);
  return { gateway, id, key: disputeKey(gateway, id) };
}

/**
 * Hold the order's refunds still while chargeback money is matched and written.
 *
 * A chargeback usually reaches Storify twice — as the dispute, and as the
 * money the gateway moved for it — and the two reports can land in the same
 * second. Each looks for the other before recording; without a hold both would
 * look before either wrote, and both would write. The hold is the stamp an
 * in-app refund sets, so everything that finds it waits the way it already
 * does: a webhook fails and is delivered again once this row exists.
 */
async function holdOrderRefunds(orderId: unknown): Promise<Date | null> {
  const stamp = new Date();
  const held = await Order.updateOne(
    {
      _id: orderId,
      $or: [
        { [REFUND_IN_FLIGHT_FIELD]: null },
        {
          [REFUND_IN_FLIGHT_FIELD]: {
            $lte: new Date(stamp.getTime() - REFUND_IN_FLIGHT_WINDOW_MS),
          },
        },
      ],
    },
    { $set: { [REFUND_IN_FLIGHT_FIELD]: stamp } },
  );
  return held.modifiedCount ? stamp : null;
}

async function releaseOrderRefunds(orderId: unknown, stamp: Date) {
  await Order.updateOne(...releaseRefundInFlightWrite(orderId, stamp)).catch(
    logRefundInFlightReleaseError,
  );
}

/**
 * Match a gateway's report of chargeback money to a row already standing for it.
 *
 * The row can exist three ways: the dispute was read first and recorded the
 * money under its own id; PayPal's dispute listed the settlement before the
 * capture reversal that moved it arrived; or an admin recorded the chargeback
 * by hand. Each time this report is the same money, so its id is kept on the
 * row as another name for it — which is also how a later failure of this id
 * finds the row.
 */
async function attachToRecordedChargeback(
  orderId: unknown,
  refund: GatewayRefundRecord,
): Promise<boolean> {
  const link = refund.chargeback;
  if (!link) return false;
  const amount = Number(refund.amount);
  const sameAmount = {
    $gte: amount - DISPUTE_MONEY_EPSILON,
    $lte: amount + DISPUTE_MONEY_EPSILON,
  };
  const standing = { orderId, type: "refund", status: "succeeded", grossAmount: sameAmount };
  const alias = { $addToSet: { "metadata.gatewayAliasIds": refund.id } };

  const recorded = await PaymentTransaction.updateOne(
    link.disputeId
      ? {
          ...standing,
          "metadata.dispute.key": disputeKey(link.gateway, link.disputeId),
          "metadata.gatewayAliasIds": { $ne: refund.id },
        }
      : {
          // Recorded from the dispute, or by hand, and not yet matched to the
          // report of the money: a report is a row of its own, never this one.
          ...standing,
          "metadata.dispute.gateway": link.gateway,
          "metadata.chargebackReport": { $exists: false },
          "metadata.gatewayAliasIds.0": { $exists: false },
        },
    alias,
  );
  if (recorded.modifiedCount) return true;

  const byHand = await PaymentTransaction.updateOne(
    {
      orderId,
      type: "refund",
      status: "succeeded",
      "metadata.chargebackByHand.gateway": link.gateway,
      "metadata.awaitingGatewayDisputes.amount": sameAmount,
    },
    {
      $pull: { "metadata.awaitingGatewayDisputes": { key: "manual" } },
      ...alias,
      ...(link.disputeId
        ? { $set: { "metadata.dispute": disputeMeta(link.gateway, link.disputeId) } }
        : {}),
    },
  );
  return byHand.modifiedCount > 0;
}

/**
 * Write one refund the gateway moved and Storify had not recorded.
 *
 * Claimed against the order the same way an in-app refund claims it, so money
 * moved elsewhere cannot take the refunded total past what was charged. Null
 * when that claim is refused; otherwise the order's payment status after it.
 */
async function recordGatewayRefundRow(params: {
  order: OrderForRefund;
  id: string;
  amount: number;
  reason: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
  /**
   * How the row falls on the sellers, when it replaces a row that already said
   * so. Left out, it is prorated over the order as every gateway refund is.
   */
  allocation?: RefundAllocationShare[] | null;
  /** The consignments the row belongs to, when an admin named them. */
  consignmentIds?: ReadonlyArray<unknown> | null;
  /** Kept from the row this one replaces; otherwise named from the metadata. */
  source?: string;
  /** Replacing a row already on the timeline: the caller says what changed. */
  quiet?: boolean;
}): Promise<{ paymentStatus: string } | null> {
  const { order, amount } = params;
  const disputed = params.metadata?.dispute as
    | { gateway?: DisputeGateway; id?: string }
    | undefined;
  const reported = params.metadata?.chargebackReport as
    | { gateway?: DisputeGateway }
    | undefined;
  const chargebackGateway = disputed?.gateway || reported?.gateway;
  const chargeback = chargebackGateway
    ? { gateway: chargebackGateway, id: disputed?.id }
    : null;
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
    { returnDocument: "after" },
  )
    .select("refundedTotal")
    .lean<{ refundedTotal?: number } | null>();

  if (!claim) {
    console.error(
      `Gateway refund ${params.id} exceeds what ${order.orderNumber} was charged; not recorded`,
    );
    return null;
  }

  const nextRefunded = Number(claim.refundedTotal || amount);
  const paymentStatus = paymentStatusFor(order, nextRefunded);
  await writePaymentStatus(order, paymentStatus);

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
      currency: String(order.currency || "USD"),
      channel: order.channel || "online",
      posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
      createdAt: order.createdAt,
    },
    amount,
    // Named so an admin reading the transaction list can tell at a glance
    // that nobody pressed a button in Storify to cause it.
    reason: params.reason,
    externalRefundId: params.id,
    gatewayCalled: true,
    createdBy: params.createdBy,
    source: params.source || (chargeback ? "gateway-chargeback" : "gateway-refund"),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.allocation ? { allocation: params.allocation } : {}),
    ...(params.consignmentIds?.length ? { consignmentIds: params.consignmentIds } : {}),
  });

  // Points follow the money, exactly as they do on an in-app refund.
  const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
  await reverseOrderLoyaltyPoints(String(order._id)).catch((error) =>
    console.error("Failed to reverse loyalty points:", error),
  );

  // On the order's timeline, named for what it was. Nobody in the store did
  // this, so without an entry the order's history showed a refunded balance
  // and no event that explained it.
  if (chargeback && !params.quiet) {
    await auditOrderRefunded(createSystemAuditContext(), order, {
      amount,
      currency: String(order.currency || "USD"),
      gatewayCalled: true,
      chargeback: {
        gatewayLabel: DISPUTE_GATEWAY_LABEL[chargeback.gateway],
        disputeId: chargeback.id,
      },
    }).catch((error) => console.error("Failed to add a chargeback to the timeline:", error));
  }
  return { paymentStatus };
}

function formatOrderMoney(amount: number, currency: string): string {
  const code = String(currency || "USD").toUpperCase();
  return `${Math.max(0, amount).toFixed(currencyMinorUnitExponent(code))} ${code}`;
}

/** Tell an admin a gateway's report of chargeback money was recorded. */
async function notifyChargebackReport(
  order: OrderForRefund,
  refund: GatewayRefundRecord,
  paymentStatus: string,
) {
  const link = refund.chargeback;
  if (!link) return;
  const holdShipment =
    paymentStatus === PAYMENT_STATUS.REFUNDED &&
    !["shipped", "delivered", "cancelled"].includes(String(order.status || ""));
  const label = DISPUTE_GATEWAY_LABEL[link.gateway];
  const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentAnomaly({
    title: "A shopper's bank took a payment back",
    message: `Order #${order.orderNumber}: ${label} took ${formatOrderMoney(
      Number(refund.amount),
      String(order.currency || "USD"),
    )} back${link.disputeId ? ` for dispute ${link.disputeId}` : ""}. It is recorded as a refund, so each seller's share comes back out of their next payout.${
      holdShipment
        ? " Hold the shipment: the order no longer counts as paid, so it cannot be fulfilled unless the store wins the money back."
        : ""
    }${
      // A refund raised for a dispute means the dispute is already decided.
      link.disputeId
        ? ""
        : ` Answer the dispute in ${DISPUTE_RESPONSE_PLACE[link.gateway]} to win it back.`
    }`,
    dedupeKey: `chargeback:${link.gateway}:${refund.id}`,
    link: `/admin/orders/${String(order._id)}`,
  }).catch((error) => console.error("Failed to report a chargeback:", error));
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
  // `charge.refunded` webhook would record its half all over again. A
  // chargeback's other names for the same money live in `gatewayAliasIds`.
  const liveIds = live.map((refund) => refund.id);
  const known = new Set<string>();
  for (const row of await PaymentTransaction.find({
    orderId: order._id,
    type: "refund",
    $or: [
      { externalId: { $in: liveIds } },
      { "metadata.gatewayRefundIds": { $in: liveIds } },
      { "metadata.gatewayAliasIds": { $in: liveIds } },
    ],
  })
    .select("externalId metadata")
    .lean<
      Array<{
        externalId?: string;
        metadata?: { gatewayRefundIds?: unknown; gatewayAliasIds?: unknown };
      }>
    >()) {
    if (row.externalId) known.add(String(row.externalId));
    for (const extra of [row.metadata?.gatewayRefundIds, row.metadata?.gatewayAliasIds]) {
      if (Array.isArray(extra)) {
        for (const id of extra) known.add(String(id));
      }
    }
  }

  let recorded = 0;

  // An in-app refund is between asking the gateway and writing its row, and
  // this is very likely that refund arriving first. Recording it now would be
  // the second row; failing now makes the gateway deliver it again, by which
  // time the row exists under this id.
  if (live.some((refund) => !known.has(refund.id)) && isRefundInFlight(order)) {
    throw new RefundInFlightError(order.orderNumber);
  }

  // Chargeback money is matched against what stands for its dispute, and the
  // dispute may be being recorded this very moment — see `holdOrderRefunds`.
  const reportsChargeback = live.some(
    (refund) => refund.chargeback && !known.has(refund.id),
  );
  const hold = reportsChargeback ? await holdOrderRefunds(order._id) : null;
  if (reportsChargeback && !hold) throw new RefundInFlightError(order.orderNumber);

  try {
    for (const refund of live) {
      if (known.has(refund.id)) continue;
      const amount = Number(refund.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (refund.chargeback) {
        // Never the dashboard refund an admin said they would send: the
        // shopper's bank took this, and pairing it would count that refund done.
        if (await attachToRecordedChargeback(order._id, refund)) continue;
      } else if (await pairWithAwaitingRefund(order._id, refund)) {
        continue;
      }

      const written = await recordGatewayRefundRow({
        order,
        id: refund.id,
        amount,
        reason: refund.reason || params.reason || "Refunded from the payment gateway",
        createdBy: params.createdBy || "gateway-webhook",
        ...(refund.chargeback
          ? {
              metadata: {
                chargebackReport: { gateway: refund.chargeback.gateway },
                ...(refund.chargeback.disputeId
                  ? {
                      dispute: disputeMeta(
                        refund.chargeback.gateway,
                        refund.chargeback.disputeId,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      });
      if (!written) continue;

      recorded += 1;
      if (refund.chargeback) {
        await notifyChargebackReport(order, refund, written.paymentStatus);
      }
    }
  } finally {
    if (hold) await releaseOrderRefunds(order._id, hold);
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

type RefundRow = {
  _id: unknown;
  orderId: unknown;
  grossAmount?: number;
  externalId?: string;
  metadata?: {
    gatewayRefundIds?: unknown;
    failedGatewayRefundIds?: unknown;
  };
};

/**
 * Every gateway refund a row stands for.
 *
 * Usually one. A pre-order refunded after its balance was paid drains two
 * Stripe charges — the deposit's and the balance's — and
 * `createRefundTransaction` writes that as ONE row: the first refund's id in
 * `externalId`, all of them in `metadata.gatewayRefundIds`.
 */
function refundLegIds(row: RefundRow): string[] {
  const extra = Array.isArray(row.metadata?.gatewayRefundIds)
    ? (row.metadata?.gatewayRefundIds as unknown[]).map(String)
    : [];
  return [row.externalId, ...extra]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index);
}

/**
 * Undo a refund the gateway later rejected.
 *
 * The row is marked failed rather than deleted, and the ledger entries are
 * reversed rather than removed — the refund was a real event on the day it was
 * made, and a set of books that quietly loses a day is worse than one showing
 * the mistake and its correction.
 *
 * **A row can stand for more than one gateway refund**, and this used to treat
 * it as if it never did. It looked the failure up by `externalId` alone, which
 * went wrong in both directions for a pre-order refunded across its deposit
 * and its balance:
 *
 *  - the BALANCE refund failing was never found (its id lives only in
 *    `metadata.gatewayRefundIds`), so the books went on saying the shopper had
 *    that money back when they did not;
 *  - the DEPOSIT refund failing reversed the WHOLE row, balance included, so
 *    the order read as not refunded while the balance had in fact gone back —
 *    and an admin who believed it would refund the shopper a second time.
 *
 * Now a row is only reversed once every refund it stands for has failed. A
 * failure of just one of them is recorded on the row and put in front of an
 * admin, but the books are left as they are: reversing a PART of a row would
 * need the refund split per charge, which the ledger, the payout engine and the
 * history replay do not have — they all read one row as one refund. Writing a
 * guessed split into all three would be the silent error this exists to stop.
 */
export async function reverseFailedOrderRefund(
  refund: Stripe.Refund,
): Promise<boolean> {
  if (!DEAD_REFUND_STATUSES.has(String(refund.status || ""))) return false;
  await connectDB();

  const txn = await PaymentTransaction.findOne({
    type: "refund",
    status: "succeeded",
    $or: [
      { externalId: refund.id },
      { "metadata.gatewayRefundIds": refund.id },
      // Another name for a chargeback's money — the refund Paystack raised to
      // pay an accepted dispute. The row stands for that one payment, so its
      // failure undoes the row, not a leg of it.
      { "metadata.gatewayAliasIds": refund.id },
    ],
  })
    .select("orderId grossAmount externalId metadata")
    .lean<RefundRow | null>();
  // Nothing recorded under this id, or it was reversed already. Either way the
  // books already say what the gateway says.
  if (!txn) return false;

  const amount = Number(txn.grossAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const order = await Order.findById(txn.orderId)
    .select(ORDER_FIELDS)
    .lean<OrderForRefund | null>();
  if (!order) return false;

  const legIds = refundLegIds(txn);
  if (legIds.length > 1) {
    // Recorded before anything is decided, and guarded, so a webhook delivered
    // twice for the same failed leg is a no-op the second time.
    //
    // The failed amount is also left waiting for a replacement: the admin is
    // told to send it again from the gateway's dashboard, and that refund's
    // report is then paired with this row instead of counted a second time on
    // top of an amount the row still stands for.
    const failedAmount =
      typeof refund.amount === "number"
        ? fromStripeAmount(
            refund.amount,
            String(refund.currency || order.currency || "USD"),
          )
        : undefined;
    const marked = await PaymentTransaction.findOneAndUpdate(
      {
        _id: txn._id,
        status: "succeeded",
        "metadata.failedGatewayRefundIds": { $ne: refund.id },
      },
      {
        $addToSet: { "metadata.failedGatewayRefundIds": refund.id },
        ...(failedAmount && failedAmount > 0
          ? {
              $push: {
                "metadata.awaitingGatewayRefunds": {
                  key: refund.id,
                  amount: failedAmount,
                },
              },
            }
          : {}),
      },
      { returnDocument: "after" },
    )
      .select("metadata")
      .lean<RefundRow | null>();
    if (!marked) return false;

    const failed = new Set(
      Array.isArray(marked.metadata?.failedGatewayRefundIds)
        ? (marked.metadata?.failedGatewayRefundIds as unknown[]).map(String)
        : [],
    );
    if (!legIds.every((id) => failed.has(id))) {
      await notifyPartialRefundFailure({ order, refund, rowAmount: amount });
      return true;
    }
    // Every refund this row stood for has now failed, so the row as a whole
    // did — which is exactly what the reversal below undoes.
  }

  return reverseWholeRefundRow({
    txn,
    order,
    amount,
    refundId: refund.id,
    supersedesPartialNotice: legIds.length > 1,
  });
}

/**
 * Tell an admin that one of the gateway refunds behind a row failed.
 *
 * The books are deliberately left alone — see `reverseFailedOrderRefund` — so
 * this message is the whole of the correction, and it has to say what to do.
 */
async function notifyPartialRefundFailure(params: {
  order: OrderForRefund;
  refund: Stripe.Refund;
  rowAmount: number;
}) {
  const { order, refund } = params;
  const currency = String(refund.currency || order.currency || "USD");
  const failedAmount =
    typeof refund.amount === "number"
      ? fromStripeAmount(refund.amount, currency)
      : undefined;
  const { notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyAdminsPaymentAnomaly({
    title: "Part of a refund failed at the gateway",
    message: `Refund ${refund.id}${
      failedAmount !== undefined
        ? ` of ${failedAmount} ${currency.toUpperCase()}`
        : ""
    } on order #${order.orderNumber} failed. It was refunded together with another charge that has not failed, so the order still shows the full ${params.rowAmount} as refunded and the shopper has not received this part. Send it again from the payment gateway's dashboard — that refund is matched to this one when the gateway reports it — or return it by hand, and do not refund it again from the order: the order already counts it, so a second refund there is either refused or counted twice.`,
    paymentIntentId:
      typeof refund.payment_intent === "string" ? refund.payment_intent : undefined,
  }).catch((error) =>
    console.error("Failed to report a partially failed refund:", error),
  );
  console.error(
    `Refund ${refund.id} on ${order.orderNumber} failed; the rest of its refund row stands`,
  );
}

async function reverseWholeRefundRow(params: {
  txn: RefundRow;
  order: OrderForRefund;
  amount: number;
  refundId: string;
  /** True when an admin was already told part of this row had failed. */
  supersedesPartialNotice: boolean;
}): Promise<boolean> {
  const { txn, order, amount } = params;

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
    { returnDocument: "after" },
  )
    .select("refundedTotal")
    .lean<{ refundedTotal?: number } | null>();

  const nextRefunded = Math.max(0, Number(updated?.refundedTotal || 0));
  await writePaymentStatus(order, paymentStatusFor(order, nextRefunded));

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

  // An admin who was told part of this row had failed was told the books still
  // showed the whole refund. They no longer do, and the earlier message would
  // otherwise send them to re-issue a part that is now accounted for.
  if (params.supersedesPartialNotice) {
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    await notifyAdminsPaymentAnomaly({
      title: "A refund failed at the gateway in full",
      message: `Every part of the ${amount} refund on order #${order.orderNumber} has now failed, so the whole refund was reversed and the order no longer shows it as refunded. Ignore the earlier message about part of it, and refund the shopper again when you are ready.`,
    }).catch((error) =>
      console.error("Failed to report a fully failed refund:", error),
    );
  }

  console.error(
    `Gateway refund ${params.refundId} failed; reversed ${amount} on ${order.orderNumber}`,
  );
  return true;
}

type DisputeRow = RefundRow & {
  status?: string;
  createdAt?: Date;
};

const DISPUTE_ROW_FIELDS =
  "orderId grossAmount status createdAt externalId metadata refundAllocation";

/** How far before a dispute opened a refund can still be its settlement. */
const DISPUTE_REFUND_LEEWAY_MS = 10 * 60 * 1000;

function disputeMoneyRow(row: DisputeRow, exact = false): DisputeMoneyRow {
  return {
    id: String(row._id),
    amount: Math.max(0, Number(row.grossAmount || 0)),
    standing: row.status === undefined || row.status === "succeeded",
    at: new Date(row.createdAt || 0).getTime(),
    ...(exact ? { exact: true } : {}),
  };
}

function oldestFirst<T extends { createdAt?: Date }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
}

/**
 * Rows recorded under other ids that may be this dispute's money, best first.
 *
 * The gateway's own refunds for it (Paystack names them); a chargeback an
 * admin recorded by hand for this gateway; a PayPal capture reversal nobody
 * has matched to a dispute; and — where the gateway settles a claim by
 * refunding — a refund recorded after the dispute opened, taken only when it is
 * the whole of what the dispute moved.
 */
async function disputeCandidates(
  order: OrderForRefund,
  reading: GatewayDisputeReading,
): Promise<Array<{ row: DisputeRow; exact: boolean }>> {
  const unlinked = {
    orderId: order._id,
    type: "refund",
    status: "succeeded",
    "metadata.dispute": { $exists: false },
  };
  const found: Array<{ row: DisputeRow; exact: boolean }> = [];
  const add = (rows: DisputeRow[], exact = false) => {
    for (const row of rows) {
      if (!found.some((entry) => String(entry.row._id) === String(row._id))) {
        found.push({ row, exact });
      }
    }
  };

  if (reading.moneyIds.length > 0) {
    add(
      await PaymentTransaction.find({
        ...unlinked,
        $or: [
          { externalId: { $in: reading.moneyIds } },
          { "metadata.gatewayRefundIds": { $in: reading.moneyIds } },
          { "metadata.gatewayAliasIds": { $in: reading.moneyIds } },
        ],
      })
        .select(DISPUTE_ROW_FIELDS)
        .lean<DisputeRow[]>(),
    );
  }
  add(
    oldestFirst(
      await PaymentTransaction.find({
        ...unlinked,
        "metadata.chargebackByHand.gateway": reading.gateway,
        "metadata.awaitingGatewayDisputes.0": { $exists: true },
      })
        .select(DISPUTE_ROW_FIELDS)
        .lean<DisputeRow[]>(),
    ),
  );
  add(
    oldestFirst(
      await PaymentTransaction.find({
        ...unlinked,
        "metadata.chargebackReport.gateway": reading.gateway,
      })
        .select(DISPUTE_ROW_FIELDS)
        .lean<DisputeRow[]>(),
    ),
  );
  if (reading.settlesThroughRefunds && reading.openedAt) {
    add(
      oldestFirst(
        await PaymentTransaction.find({
          ...unlinked,
          createdAt: {
            $gte: new Date(reading.openedAt.getTime() - DISPUTE_REFUND_LEEWAY_MS),
          },
        })
          .select(DISPUTE_ROW_FIELDS)
          .lean<DisputeRow[]>(),
      ),
      true,
    );
  }
  return found;
}

function chargebackReason(reading: GatewayDisputeReading): string {
  return `Chargeback — ${DISPUTE_GATEWAY_LABEL[reading.gateway]} dispute ${reading.disputeId}${
    reading.reason ? ` (${reading.reason})` : ""
  }: the shopper's bank took the payment back`;
}

interface DisputeMoneyOutcome {
  recorded: number;
  reversed: number;
  unreturned: number;
  /** Part of a row given back: the row replaced by the part still held. */
  partReturned: number;
  beyondSale: number;
  standing: number;
}

async function settleDisputeMoney(
  order: OrderForRefund,
  reading: GatewayDisputeReading,
): Promise<DisputeMoneyOutcome> {
  const key = disputeKey(reading.gateway, reading.disputeId);
  const linked = await PaymentTransaction.find({
    orderId: order._id,
    type: "refund",
    $or: [{ "metadata.dispute.key": key }, { externalId: key }],
  })
    .select(DISPUTE_ROW_FIELDS)
    .lean<DisputeRow[]>();
  const candidates = await disputeCandidates(order, reading);

  const plan = planDisputeSettlement({
    withdrawn: reading.withdrawn,
    taken: reading.taken,
    linked: linked.map((row) => disputeMoneyRow(row)),
    candidates: candidates.map((entry) => disputeMoneyRow(entry.row, entry.exact)),
  });

  let standing = linked
    .filter((row) => row.status === "succeeded")
    .reduce((sum, row) => sum + Number(row.grossAmount || 0), 0);

  for (const id of plan.adopt) {
    const row = candidates.find((entry) => String(entry.row._id) === id)?.row;
    if (!row) continue;
    const adopted = await PaymentTransaction.updateOne(
      { _id: row._id, status: "succeeded", "metadata.dispute": { $exists: false } },
      {
        $set: { "metadata.dispute": disputeMeta(reading.gateway, reading.disputeId) },
        $pull: { "metadata.awaitingGatewayDisputes": { key: "manual" } },
      },
    );
    if (adopted.modifiedCount) standing += Number(row.grossAmount || 0);
  }

  let recorded = 0;
  let beyondSale = 0;
  if (plan.record > DISPUTE_MONEY_EPSILON) {
    // A chargeback on money earlier refunds already gave back takes more than
    // the order has left; only what is left can be a refund.
    const fresh = await Order.findById(order._id)
      .select("total refundedTotal")
      .lean<{ total?: number; refundedTotal?: number } | null>();
    const room = Math.max(
      0,
      Number(fresh?.total ?? order.total ?? 0) - Number(fresh?.refundedTotal ?? 0),
    );
    const amount = Math.round(Math.min(plan.record, room) * 1000) / 1000;
    beyondSale = Math.round((plan.record - amount) * 1000) / 1000;

    if (amount > DISPUTE_MONEY_EPSILON) {
      const written = await recordGatewayRefundRow({
        order,
        // The dispute's own id the first time; a dispute taken again after
        // being won back needs a second row, under a name of its own.
        id: linked.length === 0 ? key : `${key}:${linked.length + 1}`,
        amount,
        reason: chargebackReason(reading),
        createdBy: `${reading.gateway}-dispute`,
        metadata: {
          dispute: disputeMeta(reading.gateway, reading.disputeId),
          ...(reading.moneyIds.length > 0 ? { gatewayAliasIds: reading.moneyIds } : {}),
        },
      });
      if (written) {
        recorded = amount;
        standing += amount;
      } else {
        beyondSale = Math.round(plan.record * 1000) / 1000;
      }
    }
  }

  let reversed = 0;
  for (const id of plan.reverse) {
    const row =
      linked.find((entry) => String(entry._id) === id) ||
      candidates.find((entry) => String(entry.row._id) === id)?.row;
    if (!row) continue;
    const amount = Number(row.grossAmount || 0);
    if (
      await reverseWholeRefundRow({
        txn: row,
        order,
        amount,
        refundId: key,
        supersedesPartialNotice: false,
      })
    ) {
      reversed += amount;
      standing -= amount;
      await auditOrderChargebackReturned(createSystemAuditContext(), order, {
        amount,
        currency: String(order.currency || "USD"),
        gatewayLabel: DISPUTE_GATEWAY_LABEL[reading.gateway],
        disputeId: reading.disputeId,
      }).catch((error) => console.error("Failed to add a won chargeback to the timeline:", error));
    }
  }

  // Part of one row came back. The row is reversed and what is still held is
  // recorded again, on the same sellers in the same proportions, so the books
  // hold exactly what the gateway does. Reversed first: the replacement must
  // fit inside what the order has left to refund, and until the row is gone
  // it is still counted there.
  let partReturned = 0;
  let unreturned = plan.unreturned;
  if (plan.split) {
    const row = [...linked, ...candidates.map((entry) => entry.row)].find(
      (entry) => String(entry._id) === plan.split!.row,
    );
    const amount = Number(row?.grossAmount || 0);
    const keep = plan.split.keep;
    if (row && amount > keep) {
      const undone = await reverseWholeRefundRow({
        txn: row,
        order,
        amount,
        refundId: key,
        supersedesPartialNotice: false,
      });
      if (undone) {
        const { scaleRefundAllocation } = await import("@/lib/returns/refund-allocation");
        const written = await recordGatewayRefundRow({
          order,
          id: `${key}:${linked.length + 1}`,
          amount: keep,
          reason: chargebackReason(reading),
          createdBy: `${reading.gateway}-dispute`,
          metadata: {
            dispute: disputeMeta(reading.gateway, reading.disputeId),
            ...(reading.moneyIds.length > 0 ? { gatewayAliasIds: reading.moneyIds } : {}),
            replaces: String(row._id),
          },
          allocation: scaleRefundAllocation(
            (row as { refundAllocation?: RefundAllocationShare[] }).refundAllocation,
            keep,
            String(order.currency || "USD"),
          ),
        });
        if (written) {
          partReturned = Math.round((amount - keep) * 1000) / 1000;
          standing -= amount - keep;
          await auditOrderChargebackReturned(createSystemAuditContext(), order, {
            amount: partReturned,
            currency: String(order.currency || "USD"),
            gatewayLabel: DISPUTE_GATEWAY_LABEL[reading.gateway],
            disputeId: reading.disputeId,
          }).catch((error) =>
            console.error("Failed to add a part-won chargeback to the timeline:", error),
          );
        } else {
          // The row is gone and its replacement could not be written, so the
          // whole row reads as given back for now. The next read of the
          // dispute finds the gateway holding more than the books and records
          // the part still held — nothing is lost, only late.
          console.error(
            `Could not re-record the part of dispute ${key} still held on ${order.orderNumber}`,
          );
          reversed += amount;
          standing -= amount;
        }
      }
    } else {
      unreturned = Math.round((standing - Math.max(0, reading.withdrawn ?? 0)) * 1000) / 1000;
    }
  }

  return {
    recorded,
    reversed: Math.round(reversed * 1000) / 1000,
    unreturned,
    partReturned,
    beyondSale,
    standing: Math.round(Math.max(0, standing) * 1000) / 1000,
  };
}

/**
 * Put a chargeback on the sellers it belongs to.
 *
 * A chargeback is recorded against the whole order and shared over every
 * seller in proportion, because nothing the gateway sends says whose goods the
 * shopper disputed. Often the store does know — the item never arrived from one
 * seller, one seller's goods were counterfeit — and until this there was no way
 * to say so: the other sellers paid for it out of their next payouts.
 *
 * Rows stay whole, so the row is reversed and the same amount recorded again,
 * scoped to the named consignments, carrying everything that tied it to its
 * dispute. The order's refunded total, the shopper's points and the dispute's
 * standing all end where they started; only who bears it moves.
 */
export async function reattributeChargeback(params: {
  orderId: string;
  transactionId: string;
  subOrderIds: string[];
  actorId: string;
  actorLabel?: string;
}): Promise<{ amount: number; sellers: number }> {
  await connectDB();
  // The consignments too: the refund fields alone carry no `subOrders`, and
  // without them no seller could ever be named.
  const order = await Order.findById(params.orderId)
    .select(`${ORDER_FIELDS} subOrders._id subOrders.vendorId`)
    .lean<OrderForRefund | null>();
  if (!order) throw new Error("Order not found");

  const subOrders = ((order as { subOrders?: Array<{ _id?: unknown; vendorId?: unknown }> })
    .subOrders || []);
  const named = subOrders.filter((sub) => params.subOrderIds.includes(String(sub._id)));
  if (named.length === 0) {
    throw new ValidationError("Choose the seller this chargeback belongs to");
  }

  const row = await PaymentTransaction.findOne({
    _id: params.transactionId,
    orderId: order._id,
    type: "refund",
    status: "succeeded",
    "metadata.source": { $in: ["gateway-chargeback", "admin-chargeback-manual"] },
  })
    .select(`${DISPUTE_ROW_FIELDS} note`)
    .lean<(DisputeRow & { note?: string; metadata?: Record<string, unknown> }) | null>();
  if (!row) {
    throw new ValidationError("That chargeback is not standing on this order any more");
  }
  const amount = Number(row.grossAmount || 0);
  if (!(amount > 0)) throw new ValidationError("That chargeback has no amount to move");

  const hold = await holdOrderRefunds(order._id);
  if (!hold) throw new RefundInFlightError(order.orderNumber);
  try {
    const undone = await reverseWholeRefundRow({
      txn: row,
      order,
      amount,
      refundId: String(row.externalId || row._id),
      supersedesPartialNotice: false,
    });
    if (!undone) {
      throw new ValidationError("That chargeback changed while it was being moved — reload and try again");
    }

    const metadata = { ...(row.metadata || {}) } as Record<string, unknown>;
    const source = String(metadata.source || "gateway-chargeback");
    delete metadata.source;
    const baseId = String(row.externalId || row._id).replace(/:seller-\d+$/, "");
    const siblings = await PaymentTransaction.countDocuments({
      orderId: order._id,
      externalId: { $regex: `^${baseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` },
    });
    const written = await recordGatewayRefundRow({
      order,
      id: `${baseId}:seller-${siblings + 1}`,
      amount,
      reason: row.note || "Chargeback",
      createdBy: params.actorId,
      source,
      quiet: true,
      consignmentIds: named.map((sub) => sub._id),
      metadata: {
        ...metadata,
        replaces: String(row._id),
        attributedBy: params.actorId,
      },
    });
    if (!written) {
      throw new Error(
        `Chargeback ${String(row._id)} on ${order.orderNumber} was reversed but could not be recorded again`,
      );
    }

    const { auditOrderChargebackAttributed } = await import("@/lib/orders/audit-order");
    const { Vendor } = await import("@/models");
    const vendors = await Vendor.find({ _id: { $in: named.map((sub) => sub.vendorId) } })
      .select("storeName")
      .lean<Array<{ storeName?: string }>>();
    await auditOrderChargebackAttributed(createSystemAuditContext(), order, {
      amount,
      currency: String(order.currency || "USD"),
      sellers: vendors.map((vendor) => vendor.storeName || "a seller"),
      actor: params.actorLabel || params.actorId,
    }).catch((error: unknown) =>
      console.error("Failed to add a chargeback move to the timeline:", error),
    );

    return { amount, sellers: named.length };
  } finally {
    await releaseOrderRefunds(order._id, hold);
  }
}

export interface DisputeApplication {
  /** The dispute is on one of this store's orders. */
  matched: boolean;
  /** Newly recorded as a chargeback. */
  recorded: number;
  /** Newly given back. */
  reversed: number;
}

/**
 * A dispute on any gateway: record what it took, reverse what it gave back,
 * book its fees, and tell an admin what changed.
 *
 * Nothing recorded it before this. The money left the gateway balance and the
 * books went on showing the sale, the cash and the vendor's payable — so the
 * vendor was paid out in full on money the store no longer had, and the
 * dispute fee was an expense nobody saw.
 *
 * The money is recorded as a refund, under the dispute's own id, so everything
 * a refund does happens here too and happens once: the order's refunded total
 * and payment state, the ledger reversing the sale in the proportions it
 * booked, the payout clawing the vendor's share back, loyalty points following
 * the money. Whose fault the dispute was is not decided here — the vendor's
 * share comes back as on any refund, and an admin who decides otherwise
 * adjusts it. Fees are the store's cost.
 *
 * Idempotent by comparison rather than by event: what the books hold for the
 * dispute is brought in line with what the gateway says, so the same dispute
 * read by a webhook twice, by the hourly sync, or out of order records nothing
 * the second time. Before recording, it looks for the same money already
 * recorded under another name — see `disputeCandidates` — and while it works
 * it holds the order's refunds still, so a report of that money arriving at
 * the same moment waits for it.
 *
 * Throws `RefundInFlightError` when a refund is already being recorded on the
 * order; a webhook answers that with a retry, the sync with the next run.
 */
export async function applyGatewayDispute(
  reading: GatewayDisputeReading | null,
  options: {
    /** Read by the sync, not delivered as it happened — see `disputeNotices`. */
    quietHistory?: boolean;
  } = {},
): Promise<DisputeApplication> {
  const application: DisputeApplication = { matched: false, recorded: 0, reversed: 0 };
  if (!reading?.disputeId) return application;
  await connectDB();

  const order = await findOrder(reading.locator);
  if (!order) return application;
  application.matched = true;

  const key = disputeKey(reading.gateway, reading.disputeId);
  let money: DisputeMoneyOutcome = {
    recorded: 0,
    reversed: 0,
    unreturned: 0,
    partReturned: 0,
    beyondSale: 0,
    standing: 0,
  };

  if (reading.withdrawn !== null) {
    const hold = await holdOrderRefunds(order._id);
    if (!hold) throw new RefundInFlightError(order.orderNumber);
    try {
      money = await settleDisputeMoney(order, reading);
    } finally {
      await releaseOrderRefunds(order._id, hold);
    }
  } else {
    // Nothing to change; what already stands is still worth saying.
    const standing = await PaymentTransaction.find({
      orderId: order._id,
      type: "refund",
      status: "succeeded",
      $or: [{ "metadata.dispute.key": key }, { externalId: key }],
    })
      .select("grossAmount")
      .lean<Array<{ grossAmount?: number }>>();
    money.standing = standing.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0);
  }
  application.recorded = money.recorded;
  application.reversed = money.reversed;

  // Whatever the gateway holds for this dispute beyond what the refund rows
  // could take — earlier refunds had already given it back — is a loss of its
  // own. Brought in line with the gateway every read: booked when taken, and
  // given back when the store wins it.
  if (reading.withdrawn !== null) {
    const { postChargebackLoss } = await import("@/lib/finance/post-events");
    await postChargebackLoss({
      disputeId: key,
      orderId: order._id,
      target: Math.max(0, reading.withdrawn - money.standing),
      currency: String(order.currency || reading.currency || "USD"),
    }).catch((error) => console.error("Failed to book a chargeback loss:", error));
  }

  if (reading.fees.length > 0) {
    const { postDisputeFee } = await import("@/lib/finance/post-events");
    for (const fee of reading.fees) {
      await postDisputeFee({
        disputeId: key,
        orderId: order._id,
        amount: fee.amount,
        currency: fee.currency,
        returned: fee.returned,
        part: fee.part,
        date: fee.date,
        note: fee.note,
      }).catch((error) => console.error("Failed to post a dispute fee:", error));
    }
  }

  const after =
    money.recorded > 0 || money.reversed > 0
      ? await Order.findById(order._id)
          .select("status paymentStatus")
          .lean<{ status?: string; paymentStatus?: string } | null>()
      : null;
  const notices = disputeNotices({
    reading,
    orderNumber: order.orderNumber,
    ...money,
    quietHistory: options.quietHistory,
    ...(after
      ? {
          orderStatus: after.status,
          orderFullyRefunded: after.paymentStatus === PAYMENT_STATUS.REFUNDED,
        }
      : {}),
  });
  if (notices.length > 0) {
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    for (const notice of notices) {
      await notifyAdminsPaymentAnomaly({
        ...notice,
        link: `/admin/orders/${String(order._id)}`,
      }).catch((error) => console.error("Failed to report a dispute:", error));
    }
  }

  return application;
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

/**
 * Where a Paystack transaction's order is found.
 *
 * The order keeps the transaction's numeric id (`paystackTransactionId`,
 * `paymentId`) and its reference (`paystackReference`) apart, and a refund
 * names whichever it has — usually only the reference. Looking the reference up
 * as the id found no order at all.
 */
function paystackLocator(transaction: { id?: string; reference?: string }): OrderLocator {
  const id = String(transaction.id || "");
  const reference = String(transaction.reference || "");
  return {
    paystackTransactionId: id || reference,
    paymentId: id || reference,
    ...(reference ? { paystackReference: reference } : {}),
  };
}

/** Paystack: kobo, and an order found by the transaction. */
export function readPaystackRefund(refund: {
  id?: unknown;
  status?: string;
  amount?: number | string;
  currency?: string;
  transaction_reference?: string;
  transaction?: { id?: unknown; reference?: string } | null;
}): GatewayRefundReading | null {
  const id = String(refund?.id || "");
  if (!id) return null;

  const reference = refund.transaction_reference || refund.transaction?.reference || "";
  const transactionId = refund.transaction?.id ? String(refund.transaction.id) : "";
  if (!reference && !transactionId) return null;

  const status = String(refund.status || "").toLowerCase();
  return {
    locator: paystackLocator({ id: transactionId, reference }),
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
        live: PAYSTACK_LIVE_REFUND_STATUSES.has(status),
      },
    ],
  };
}

/**
 * A transaction's refunds, as Paystack's API lists them.
 *
 * The `refund.*` webhook reliably names neither the refund's id nor the dispute
 * an accepted chargeback's refund was raised to pay — its documented payloads
 * carry a reference and an amount — so the webhook asks the API for the
 * transaction's refunds, and this records what they say: live refunds not yet
 * on the books, failed ones reversed, and a refund raised for a dispute as that
 * dispute's chargeback.
 */
export async function reconcilePaystackRefunds(params: {
  transaction: { id?: string; reference?: string };
  refunds: PaystackRefundLike[];
}): Promise<number> {
  const records: GatewayRefundRecord[] = [];
  for (const refund of params.refunds || []) {
    const id = refund?.id === null || refund?.id === undefined ? "" : String(refund.id);
    if (!id) continue;
    const status = String(refund.status || "").toLowerCase();
    if (status === "failed") {
      // Recorded and then failed: the row comes back off the books. Unknown:
      // nothing to do.
      await reverseFailedGatewayRefund(id);
      continue;
    }
    const disputeId = paystackRefundDisputeId(refund);
    records.push({
      id,
      amount: fromPaystackAmountSubunits(
        Number(refund.amount || 0),
        String(refund.currency || "NGN"),
      ),
      live: PAYSTACK_LIVE_REFUND_STATUSES.has(status),
      ...(disputeId
        ? {
            chargeback: { gateway: "paystack" as const, disputeId },
            reason: `Chargeback — Paystack dispute ${disputeId} was accepted and the shopper refunded`,
          }
        : {}),
    });
  }

  return reconcileGatewayOrderRefunds({
    locator: paystackLocator(params.transaction),
    reason: "Refunded from the payment gateway",
    createdBy: "paystack-webhook",
    refunds: records,
  });
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
    // Either capture can be the one refunded from the PayPal dashboard: a
    // pre-order's deposit is the order's `paypalCaptureId`, but a balance paid
    // with PayPal is its own capture, recorded only as the balance reference.
    // Looking at the deposit alone found no order for a balance refund, so it
    // went unrecorded — the same gap the Stripe adapter closes above.
    locator: {
      paypalCaptureId: captureId,
      preorderBalancePaymentIntentId: `${PAYPAL_BALANCE_REFERENCE_PREFIX}${captureId}`,
    },
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

/**
 * PayPal reversing a capture: a card chargeback, or a claim decided against
 * the store.
 *
 * Money the shopper took back rather than was sent, so it is a chargeback —
 * never paired with a refund an admin is still to send, and matched to its
 * dispute when that dispute is read (a reversal names no dispute). Recording it
 * as a plain refund let it pair with a refund an admin had recorded by hand
 * and was waiting on, which then never went out.
 */
export function readPayPalReversal(
  resource: Parameters<typeof readPayPalRefund>[0],
): GatewayRefundReading | null {
  const reading = readPayPalRefund(resource);
  if (!reading) return null;
  return {
    ...reading,
    reason: "Chargeback — PayPal reversed the payment for a dispute or the shopper's bank",
    createdBy: "paypal-reversal",
    refunds: reading.refunds.map((refund) => ({
      ...refund,
      chargeback: { gateway: "paypal" as const },
    })),
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
