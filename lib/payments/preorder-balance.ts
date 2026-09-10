import { Types } from "mongoose";
import type Stripe from "stripe";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  fetchStripePaymentFee,
  fromStripeAmount,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { gatewayFeeUpdate, type GatewayFee } from "@/lib/payments/gateway-fee";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
} from "@/lib/orders/preorders";

/**
 * Collecting the balance on a deposit-mode pre-order.
 *
 * Checkout charges only the deposit (plus shipping and tax) and leaves the
 * order `partially_paid` with `preorderOutstandingAmount` recording what is
 * still to come. Until this module the only way that money could arrive was
 * offline: the "payment due" notification told the shopper to pay and gave
 * them nowhere to do it. This is the online path — one PaymentIntent for
 * exactly the balance, tagged with `kind: preorder_balance` so the Stripe
 * webhook can tell it apart from a checkout intent (which would otherwise try
 * to build a second order out of it).
 *
 * `settlePreorderBalanceFromIntent` is reached from both the webhook and the
 * customer's own confirm call, in either order and possibly twice, so it is
 * idempotent: the order is claimed with a single conditional update, and every
 * side effect runs only for the caller that won the claim.
 *
 * The rule the whole module is built around: **money Stripe has captured is
 * never dropped on the floor.** Every path that cannot record a captured
 * balance — the order was cancelled underneath it, an admin recorded the
 * balance offline first, the amount does not match what is owed — refunds the
 * charge and raises an admin anomaly rather than returning quietly. Silence
 * there is a shopper who paid and has nothing to show for it.
 */

export const PREORDER_BALANCE_CHECKOUT_KIND = "preorder_balance";

type SettingsDocument = Awaited<ReturnType<typeof getSettings>>;

type BalanceOrder = {
  _id: unknown;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  paymentFee?: number;
  paymentFeeCurrency?: string;
  paymentFeeRate?: number;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  channel?: string;
  createdAt?: Date;
  guestEmailPresent?: boolean;
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderReleaseDate?: Date;
  preorderOutstandingAmount?: number;
  preorderBalancePaymentIntentId?: string;
  preorderBalancePaidAt?: Date;
  items?: Array<{ purchaseType?: string }>;
};

function orderCurrency(order: BalanceOrder, settings: SettingsDocument) {
  return String(order.currency || settings.general?.defaultCurrency || "USD")
    .trim()
    .toUpperCase();
}

function stripeClientFor(settings: SettingsDocument) {
  const stripeSettings = settings.payment?.stripe;
  if (!stripeSettings?.enabled) {
    throw new ValidationError("Card payments are not available right now");
  }
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!isStripeSecretKeyConfigured(secretKey)) {
    throw new ValidationError("Card payments are not configured");
  }
  return getStripeForSecretKey(secretKey);
}

/**
 * The order's gateway fee once the balance charge is added to it.
 *
 * `Order.paymentFee` is one figure for the whole order, and the ledger nets it
 * off the charge row (`buildChargePayload`). Stopping at the deposit's fee
 * would report the balance as free to collect — the same overstated net the
 * fee columns were introduced to end. Both charges settle into the same
 * Stripe balance, so their fees share a currency and add; the deposit's
 * conversion rate is kept only when the balance did not report a different
 * one, since a blended rate would be a number nobody computed.
 *
 * Nothing is written when the balance fee cannot be read (it is fetched, not
 * inferred) or when the two fees somehow disagree on currency: absence is the
 * honest record, and a wrong total is worse than a missing one.
 */
export function combinedPaymentFee(
  order: Pick<BalanceOrder, "paymentFee" | "paymentFeeCurrency" | "paymentFeeRate">,
  balanceFee: GatewayFee | undefined,
): GatewayFee | undefined {
  if (!balanceFee) return undefined;
  const existing = Number(order.paymentFee);
  const existingCurrency = String(order.paymentFeeCurrency || "")
    .trim()
    .toUpperCase();
  if (!existingCurrency || !Number.isFinite(existing) || existing < 0) {
    return balanceFee;
  }
  if (existingCurrency !== balanceFee.currency) return undefined;
  const rate =
    balanceFee.rate === undefined
      ? order.paymentFeeRate
      : order.paymentFeeRate === undefined || order.paymentFeeRate === balanceFee.rate
        ? balanceFee.rate
        : undefined;
  return {
    amount: existing + balanceFee.amount,
    currency: balanceFee.currency,
    ...(rate === undefined ? {} : { rate }),
  };
}

/** An intent the shopper can still confirm — anything else needs a fresh one. */
const REUSABLE_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
];

type PreorderBalanceIntentResult =
  | {
      /** The balance was already collected — nothing to pay. */
      alreadyPaid: true;
    }
  | {
      alreadyPaid?: false;
      clientSecret: string;
      paymentIntentId: string;
      amount: number;
      currency: string;
    };

export async function createPreorderBalanceIntent(params: {
  orderId: string;
  customerId: string;
  customerEmail?: string;
  locale?: string;
  settings?: SettingsDocument;
}): Promise<PreorderBalanceIntentResult> {
  if (!Types.ObjectId.isValid(params.orderId)) {
    throw new ValidationError("Order not found");
  }
  const order = (await Order.findOne({
    _id: params.orderId,
    customerId: params.customerId,
  }).lean()) as BalanceOrder | null;
  if (!order) throw new ValidationError("Order not found");

  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    throw new ValidationError("There is no balance due on this order");
  }

  const settings = params.settings || (await getSettings());
  const stripe = stripeClientFor(settings);
  const currency = orderCurrency(order, settings);
  const amount = toStripeAmount(balanceDue, currency);
  if (!(amount > 0)) {
    throw new ValidationError("There is no balance due on this order");
  }

  // A second click (or a reload mid-payment) must not mint a second intent:
  // two open intents for the same balance is two chances to charge it.
  if (order.preorderBalancePaymentIntentId) {
    const existing = await stripe.paymentIntents
      .retrieve(order.preorderBalancePaymentIntentId)
      .catch(() => null);
    if (existing?.status === "succeeded") {
      // Paid, but the settle path has not run yet (webhook still in flight).
      // Run it now rather than asking for money that already arrived, and
      // report it as a settled balance — the shopper did nothing wrong, so
      // this must not surface as a payment error.
      await settlePreorderBalanceFromIntent(existing, settings);
      return { alreadyPaid: true };
    }
    if (
      existing &&
      existing.client_secret &&
      REUSABLE_INTENT_STATUSES.includes(existing.status) &&
      existing.amount === amount &&
      existing.currency.toUpperCase() === currency
    ) {
      return {
        clientSecret: existing.client_secret,
        paymentIntentId: existing.id,
        amount: balanceDue,
        currency,
      };
    }
  }

  // Two things stop a double charge here, because one is not enough. The
  // idempotency key makes two concurrent creates return the SAME intent from
  // Stripe (a plain create would mint two, and the second `$set` below would
  // hide the first behind a live client secret). The conditional stamp then
  // makes sure only one intent is ever the order's, and cancels ours if it
  // lost — an uncancelled loser is a chargeable intent nothing is watching.
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ["card"],
      receipt_email: params.customerEmail || undefined,
      description: `Pre-order balance for order #${order.orderNumber}`,
      metadata: {
        kind: PREORDER_BALANCE_CHECKOUT_KIND,
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        userId: params.customerId,
        locale: params.locale || "en",
      },
    },
    {
      idempotencyKey: `preorder-balance:${String(order._id)}:${amount}:${currency}`,
    },
  );
  if (!paymentIntent.client_secret) {
    throw new ValidationError("Failed to initialize card payment");
  }

  const stamped = await Order.findOneAndUpdate(
    {
      _id: order._id,
      $or: [
        { preorderBalancePaymentIntentId: null },
        { preorderBalancePaymentIntentId: { $exists: false } },
        { preorderBalancePaymentIntentId: paymentIntent.id },
      ],
    },
    { $set: { preorderBalancePaymentIntentId: paymentIntent.id } },
  )
    .select("_id")
    .lean();
  if (!stamped) {
    await stripe.paymentIntents
      .cancel(paymentIntent.id)
      .catch((err) =>
        console.error("Failed to cancel a superseded balance intent:", err),
      );
    throw new ValidationError(
      "A balance payment for this order is already in progress. Refresh the page and try again.",
    );
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: balanceDue,
    currency,
  };
}

async function readBalanceFee(
  settings: SettingsDocument,
  paymentIntentId: string,
): Promise<GatewayFee | undefined> {
  const credentials = resolveStripeCredentials(settings.payment?.stripe);
  if (!isStripeSecretKeyConfigured(credentials.secretKey)) return undefined;
  return fetchStripePaymentFee(
    getStripeForSecretKey(credentials.secretKey),
    paymentIntentId,
  );
}

/**
 * Give back a balance that was captured but cannot be recorded.
 *
 * The alternative is keeping money for an order that will never show it, which
 * is the one outcome this flow must not produce. Idempotent on Stripe's side
 * through the key, so a retried webhook cannot refund twice, and loud either
 * way: admins are told whether the money went back or is still sitting there.
 */
async function refundUnrecordableBalance(params: {
  paymentIntent: Stripe.PaymentIntent;
  settings: SettingsDocument;
  orderNumber?: string;
  why: string;
}): Promise<void> {
  const { paymentIntent, settings, why } = params;
  const captured =
    typeof paymentIntent.amount_received === "number"
      ? paymentIntent.amount_received
      : paymentIntent.amount;
  const amount = fromStripeAmount(captured, paymentIntent.currency);
  const orderLabel = params.orderNumber ? ` for order #${params.orderNumber}` : "";
  let refunded = false;
  try {
    const credentials = resolveStripeCredentials(settings.payment?.stripe);
    if (!isStripeSecretKeyConfigured(credentials.secretKey)) {
      throw new Error("Stripe is not configured for refunds");
    }
    await getStripeForSecretKey(credentials.secretKey).refunds.create(
      {
        payment_intent: paymentIntent.id,
        reason: "requested_by_customer",
        metadata: { note: `Unrecordable pre-order balance: ${why}` },
      },
      { idempotencyKey: `preorder-balance-refund:${paymentIntent.id}` },
    );
    refunded = true;
  } catch (err) {
    console.error(
      `Failed to refund an unrecordable pre-order balance (${paymentIntent.id}):`,
      err,
    );
  }

  const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentAnomaly({
    title: refunded
      ? "Pre-order balance refunded automatically"
      : "Pre-order balance captured but NOT recorded",
    message: refunded
      ? `A pre-order balance of ${amount} ${paymentIntent.currency.toUpperCase()}${orderLabel} could not be recorded (${why}), so it was refunded to the shopper. No action is needed unless the shopper says otherwise.`
      : `A pre-order balance of ${amount} ${paymentIntent.currency.toUpperCase()}${orderLabel} was captured but could not be recorded (${why}), and the automatic refund also failed. Refund payment ${paymentIntent.id} from the Stripe dashboard.`,
    paymentIntentId: paymentIntent.id,
  }).catch((err) =>
    console.error("Failed to raise a pre-order balance anomaly:", err),
  );
}

type SettlePreorderBalanceResult = {
  settled: boolean;
  orderId?: string;
  /** Set when nothing was done because the balance was already recorded. */
  alreadySettled?: boolean;
  reason?: string;
};

/**
 * Record a succeeded balance intent on its order.
 *
 * Safe to call from the webhook and from the customer's confirm call, in any
 * order and any number of times: the conditional update below is the only
 * thing that decides who wins, and a loser returns `alreadySettled`.
 */
export async function settlePreorderBalanceFromIntent(
  paymentIntent: Stripe.PaymentIntent,
  settings: SettingsDocument,
): Promise<SettlePreorderBalanceResult> {
  const metadata = (paymentIntent.metadata || {}) as Record<
    string,
    string | undefined
  >;
  if (metadata.kind !== PREORDER_BALANCE_CHECKOUT_KIND) {
    return { settled: false, reason: "not_a_balance_intent" };
  }
  const orderId = metadata.orderId;
  if (!orderId || !Types.ObjectId.isValid(orderId)) {
    console.error("Pre-order balance intent without an order id:", paymentIntent.id);
    return { settled: false, reason: "missing_order" };
  }
  if (paymentIntent.status !== "succeeded") {
    return { settled: false, orderId, reason: "not_succeeded" };
  }

  const order = (await Order.findById(orderId).lean()) as BalanceOrder | null;
  if (!order) {
    console.error("Pre-order balance intent for unknown order:", paymentIntent.id);
    return { settled: false, orderId, reason: "missing_order" };
  }
  if (
    order.preorderBalancePaidAt &&
    order.preorderBalancePaymentIntentId === paymentIntent.id
  ) {
    return { settled: false, orderId, alreadySettled: true };
  }

  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    // Nothing left to owe: the order was cancelled under the shopper, or an
    // admin recorded the balance offline while the payment was in flight. The
    // capture is still real money, so it goes back rather than vanishing into
    // an order that shows no trace of it.
    console.error(
      `Pre-order balance intent ${paymentIntent.id} succeeded but order ${order.orderNumber} has no balance due (payment ${order.paymentStatus}, status ${order.status})`,
    );
    await refundUnrecordableBalance({
      paymentIntent,
      settings,
      orderNumber: order.orderNumber,
      why: `order ${order.orderNumber} has no balance due (payment ${order.paymentStatus}, status ${order.status})`,
    });
    return { settled: false, orderId, reason: "no_balance_due" };
  }

  const currency = orderCurrency(order, settings);
  const expectedAmount = toStripeAmount(balanceDue, currency);
  const received =
    typeof paymentIntent.amount_received === "number"
      ? paymentIntent.amount_received
      : paymentIntent.amount;
  if (
    received !== expectedAmount ||
    paymentIntent.currency.toUpperCase() !== currency
  ) {
    console.error(
      `Pre-order balance intent ${paymentIntent.id} paid ${received} ${paymentIntent.currency} but order ${order.orderNumber} is owed ${expectedAmount} ${currency}`,
    );
    await refundUnrecordableBalance({
      paymentIntent,
      settings,
      orderNumber: order.orderNumber,
      why: `paid ${received} ${paymentIntent.currency.toUpperCase()} against a balance of ${expectedAmount} ${currency}`,
    });
    return { settled: false, orderId, reason: "amount_mismatch" };
  }

  const now = new Date();

  // A pay-later pre-order took no money at checkout, so it carries no Stripe
  // reference and a `pay_later` method that the custody rule reads as "the
  // vendor holds the cash" (`lib/payment-custody.ts`). Left alone, the ledger
  // would post no cash at all for money the platform is holding, the vendor
  // would never become payable, and the refund path would have no intent to
  // refund. Stripe collected it, so the order is stamped as the card payment
  // it now is. A deposit order already carries both and keeps them.
  const custodyUpdate = order.stripePaymentIntentId
    ? {}
    : {
        paymentMethod: "card",
        paymentId: paymentIntent.id,
        stripePaymentIntentId: paymentIntent.id,
      };

  // What Stripe kept of the balance, stamped in the same write that records
  // the payment — the rule every other capture follows (`gatewayFeeUpdate`).
  // Read before the claim so the claim stays a single conditional update, and
  // never allowed to stop it: a store that switched Stripe off between the
  // charge and this webhook still has to record the money it took.
  const feeUpdate = gatewayFeeUpdate(
    combinedPaymentFee(order, await readBalanceFee(settings, paymentIntent.id)),
  );

  // The claim. Only an order still owed its balance can be settled, and only
  // once; the loser of a webhook/confirm race sees no document and stops.
  const claimed = (await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      paymentStatus: {
        $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIALLY_PAID],
      },
      $or: [
        { preorderBalancePaidAt: null },
        { preorderBalancePaidAt: { $exists: false } },
      ],
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        preorderBalancePaymentIntentId: paymentIntent.id,
        preorderBalancePaidAt: now,
        // Every live consignment is now collected — the deposit order left
        // them pending because no vendor had a claim on the deposit.
        "subOrders.$[sub].paymentStatus": PAYMENT_STATUS.PAID,
        "subOrders.$[sub].paidAt": now,
        ...custodyUpdate,
        ...feeUpdate,
      },
    },
    {
      new: true,
      arrayFilters: [{ "sub.status": { $ne: ORDER_STATUS.CANCELLED } }],
    },
  ).lean()) as BalanceOrder | null;
  if (!claimed) {
    // Two very different losses wear the same empty result. A racing caller
    // that already recorded THIS intent is the happy one. Anything else — a
    // cancel that landed between the capture and the claim, a refund — means
    // the money has nowhere to go, and it goes back.
    const current = (await Order.findById(order._id).lean()) as BalanceOrder | null;
    if (current?.preorderBalancePaymentIntentId === paymentIntent.id && current?.preorderBalancePaidAt) {
      return { settled: false, orderId, alreadySettled: true };
    }
    console.error(
      `Pre-order balance intent ${paymentIntent.id} lost its claim on order ${order.orderNumber} (payment ${current?.paymentStatus}, status ${current?.status})`,
    );
    await refundUnrecordableBalance({
      paymentIntent,
      settings,
      orderNumber: order.orderNumber,
      why: `order ${order.orderNumber} stopped owing a balance while the payment was in flight (payment ${current?.paymentStatus}, status ${current?.status})`,
    });
    return { settled: false, orderId, reason: "claim_lost" };
  }

  // Money in: the charge row grows to the full total, the ledger posts
  // "Balance collected" against the receivable it raised at deposit time,
  // and the things that waited for a fully paid order (loyalty, stats) run.
  const { ensureChargeTransaction } = await import("@/lib/payments/payment-transactions");
  await ensureChargeTransaction({
    _id: String(claimed._id),
    orderNumber: claimed.orderNumber,
    paymentMethod: claimed.paymentMethod,
    paymentStatus: claimed.paymentStatus,
    paymentId: claimed.paymentId,
    stripePaymentIntentId: claimed.stripePaymentIntentId,
    subtotal: claimed.subtotal,
    shippingCost: claimed.shippingCost,
    tax: claimed.tax,
    discount: claimed.discount,
    total: claimed.total,
    preorderOutstandingAmount: claimed.preorderOutstandingAmount,
    paymentFee: claimed.paymentFee,
    paymentFeeCurrency: claimed.paymentFeeCurrency,
    paymentFeeRate: claimed.paymentFeeRate,
    currency,
    channel: claimed.channel || "online",
    paymentMetadata: { preorderBalancePaymentIntentId: paymentIntent.id },
    createdAt: claimed.createdAt,
  }).catch((err) =>
    console.error("Failed to sync pre-order balance transaction:", err),
  );
  const { postOrderPaidSafely } = await import("@/lib/finance/post-events");
  postOrderPaidSafely(claimed._id);

  const { auditOrderPaid, systemActor } = await import("@/lib/orders/audit-order");
  await auditOrderPaid(
    systemActor(),
    { _id: String(claimed._id), orderNumber: claimed.orderNumber },
    {
      gateway: "Stripe",
      amount: balanceDue,
      currency,
      transactionId: paymentIntent.id,
      partial: false,
    },
  ).catch((err) =>
    console.error("Failed to audit pre-order balance payment:", err),
  );

  const { notifyAdminsPaymentReceived } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentReceived(
    {
      orderId: String(claimed._id),
      orderNumber: claimed.orderNumber,
      amount: balanceDue,
      currency,
      paymentMethod: claimed.paymentMethod,
    },
    { settings },
  ).catch((err) =>
    console.error("Failed to notify admins of pre-order balance:", err),
  );

  const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } =
    await import("@/lib/customers/customer");
  await awardOrderLoyaltyPoints(String(claimed._id)).catch((err) =>
    console.error("Failed to award loyalty points:", err),
  );
  refreshCustomerStatsForOrder(claimed).catch((err) =>
    console.error("Failed to refresh customer stats:", err),
  );

  // The balance was requested because the goods are in: release them. Mirrors
  // the admin "ready" action, including the stock claim — a pre-order sitting
  // on payment_due has not consumed its received units yet. If the stock is
  // not recorded the order stays on payment_due (paid), and the admin's own
  // "Ready" now goes through because the balance reads as settled.
  if (claimed.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE) {
    await releaseSettledPreorder(
      { ...claimed, guestEmailPresent: Boolean(claimed.guestEmail) },
      settings,
    ).catch((err) =>
      console.error("Failed to release paid pre-order for fulfilment:", err),
    );
  }

  return { settled: true, orderId: String(claimed._id) };
}

async function releaseSettledPreorder(
  order: BalanceOrder,
  settings: SettingsDocument,
) {
  const outcome = await consumePreorderStockOnReady(String(order._id));
  if (!outcome.consumed && !outcome.alreadyConsumed) {
    console.error(
      `Pre-order ${order.orderNumber} balance paid but stock not released: ${outcome.error}`,
    );
    return;
  }
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
    },
    {
      $set: {
        status: ORDER_STATUS.PROCESSING,
        preorderStatus: PREORDER_ITEM_STATUS.READY,
        processingAt: new Date(),
        "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.READY,
        "subOrders.$[sub].status": ORDER_STATUS.PROCESSING,
        "subOrders.$[sub].items.$[subItem].preorderStatus":
          PREORDER_ITEM_STATUS.READY,
      },
    },
    {
      new: true,
      arrayFilters: [
        { "item.purchaseType": PURCHASE_TYPE.PREORDER },
        // ONLY the consignments still waiting on the pre-order. An order can
        // mix a pre-order from one seller with stock lines from another that
        // have already shipped, and a blanket write pulled those back to
        // `processing` — telling the shopper goods they are holding are being
        // packed.
        { "sub.status": ORDER_STATUS.PREORDERED },
        { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
      ],
    },
  ).lean();
  if (!updated) return;

  // A guest order's `customerId` is its cart, not a user — notifying it would
  // file the update against nobody. Guests are told by email elsewhere.
  if (order.guestEmailPresent || !order.customerId) return;
  const { notifyPreorderCustomerUpdate } = await import("@/lib/notifications/notifications");
  await notifyPreorderCustomerUpdate(
    String(order.customerId),
    order.orderNumber,
    "ready",
    String(order._id),
    { releaseDate: order.preorderReleaseDate, settings },
  ).catch((err) =>
    console.error("Failed to notify customer of released pre-order:", err),
  );
}

