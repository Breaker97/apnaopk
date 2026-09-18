import { Types } from "mongoose";
import type Stripe from "stripe";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  fetchStripePaymentFee,
  fromStripeAmount,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { gatewayFeeUpdate, type GatewayFee } from "@/lib/payments/gateway-fee";
import { resolveStripeCustomerId } from "@/lib/payments/stripe-customer";
import {
  getPreorderBalanceDue,
  owesPreorderBalanceMatch,
} from "@/lib/orders/order-payment-status";
import {
  OFFLINE_BALANCE_REFERENCE_PREFIX,
  isStripeBalanceReference,
} from "@/lib/payments/preorder-balance-reference";
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
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderReleaseDate?: Date;
  preorderOutstandingAmount?: number;
  preorderBalancePaymentIntentId?: string;
  preorderBalancePaidAt?: Date;
  /** The Customer a card was saved against at checkout — see the order model. */
  stripeCustomerId?: string;
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

/**
 * The order columns a balance payment's fee writes: the running total the
 * charge row reads, and the balance's own share of it, which the ledger needs
 * to post that fee on its own day under its own key. Nothing when the combined
 * fee cannot be stated — the same honesty `combinedPaymentFee` keeps.
 */
export function balanceFeeUpdate(
  order: Pick<BalanceOrder, "paymentFee" | "paymentFeeCurrency" | "paymentFeeRate">,
  balanceFee: GatewayFee | undefined,
): Record<string, unknown> {
  const combined = combinedPaymentFee(order, balanceFee);
  if (!combined || !balanceFee) return {};
  return {
    ...gatewayFeeUpdate(combined),
    preorderBalancePaymentFee: balanceFee.amount,
  };
}

/** An intent the shopper can still confirm — anything else needs a fresh one. */
const REUSABLE_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
];

/**
 * An intent that is neither payable nor finished: the money may yet land.
 *
 * Nothing may be built on top of one. Replacing it would leave two live
 * charges against one balance — the second refunded on arrival, but not
 * before the shopper's statement showed both.
 */
const IN_FLIGHT_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = [
  "processing",
  "requires_capture",
];

/**
 * Let go of a stamped intent that can no longer collect the balance.
 *
 * Conditional on the id AND on the balance still being unpaid, because the
 * same field is the record of the payment once one lands: clearing a settled
 * reference would let the same balance be asked for a second time.
 */
async function releaseStaleBalanceIntent(orderId: unknown, intentId: string) {
  await Order.updateOne(
    {
      _id: orderId,
      preorderBalancePaymentIntentId: intentId,
      $or: [
        { preorderBalancePaidAt: null },
        { preorderBalancePaidAt: { $exists: false } },
      ],
    },
    { $unset: { preorderBalancePaymentIntentId: "" } },
  ).catch((err) =>
    console.error("Failed to release a stale pre-order balance intent:", err),
  );
}

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
  /** The signed-in shopper, when there is one. The order must be theirs. */
  customerId?: string;
  /**
   * True when the caller proved themselves with a balance link instead
   * (`lib/payments/preorder-balance-link.ts`). The token is a signature over
   * the order id, so the order IS the claim and there is no customer to match
   * it against — which is the whole point of it, for a guest whose order has
   * no user standing behind it.
   */
  viaAccessLink?: boolean;
  customerEmail?: string;
  locale?: string;
  settings?: SettingsDocument;
}): Promise<PreorderBalanceIntentResult> {
  if (!Types.ObjectId.isValid(params.orderId)) {
    throw new ValidationError("Order not found");
  }
  if (!params.viaAccessLink && !params.customerId) {
    throw new ValidationError("Order not found");
  }
  const order = (await Order.findOne(
    params.viaAccessLink
      ? { _id: params.orderId }
      : { _id: params.orderId, customerId: params.customerId },
  ).lean()) as BalanceOrder | null;
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
  //
  // The other half is letting go. A stamped intent that can no longer be paid
  // — cancelled, or minted against an amount the order no longer owes — used
  // to sit on the order for good, and because the stamp below only accepts an
  // empty field or its own id, every later attempt was refused as "already in
  // progress". That is a shopper locked out of paying for their own order
  // with no way back that does not involve editing the database.
  const stampedIntentId = order.preorderBalancePaymentIntentId;
  let staleIntent: Stripe.PaymentIntent | null = null;
  let staleIntentId: string | undefined;
  // Only a Stripe intent can be retrieved from Stripe. An offline record or a
  // PayPal capture in the same field would fail the call outright and lock the
  // shopper out of paying — see `preorder-balance-reference.ts`.
  if (isStripeBalanceReference(stampedIntentId)) {
    const existing = await stripe.paymentIntents
      .retrieve(stampedIntentId)
      .catch(() => null);
    if (existing?.status === "succeeded") {
      // Paid, but the settle path has not run yet (webhook still in flight).
      // Run it now rather than asking for money that already arrived — the
      // shopper did nothing wrong, so a settled balance must not surface as
      // a payment error.
      const outcome = await settlePreorderBalanceFromIntent(existing, settings);
      if (outcome.settled || outcome.alreadySettled) return { alreadyPaid: true };
      // Settling can also decide the capture cannot be recorded and send it
      // straight back (`refundUnrecordableBalance`). Calling that "already
      // paid" showed the shopper a success for money they no longer have,
      // against a balance that is still owed. The intent is spent either way,
      // so it is released and they are given one they can actually pay.
      staleIntent = existing;
    } else if (
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
    } else if (existing && IN_FLIGHT_INTENT_STATUSES.includes(existing.status)) {
      // Neither payable nor spent: the capture is still moving. Handing out a
      // second intent here is how a shopper ends up charged twice for one
      // balance, so they are asked to wait instead.
      throw new ValidationError(
        "Your balance payment is still going through. Refresh the page in a moment to see where it stands.",
      );
    } else {
      staleIntent = existing;
    }
    staleIntentId = existing?.id || stampedIntentId;

    await releaseStaleBalanceIntent(order._id, stampedIntentId);
    // An open intent nobody is watching is a chargeable one: a shopper who
    // still had the old form on screen could pay an amount this order no
    // longer owes, and the webhook would refund it right back at them.
    if (staleIntent && REUSABLE_INTENT_STATUSES.includes(staleIntent.status)) {
      await stripe.paymentIntents
        .cancel(staleIntent.id)
        .catch((err) =>
          console.error("Failed to cancel a stale balance intent:", err),
        );
    }
  }

  // Two things stop a double charge here, because one is not enough. The
  // idempotency key makes two concurrent creates return the SAME intent from
  // Stripe (a plain create would mint two, and the second `$set` below would
  // hide the first behind a live client secret). The conditional stamp then
  // makes sure only one intent is ever the order's, and cancels ours if it
  // lost — an uncancelled loser is a chargeable intent nothing is watching.
  // The balance is the one charge on a pre-order that is always made by a
  // signed-in shopper against an order that already exists, so it is also the
  // one place a Customer can be filled in after the fact — an order whose
  // deposit predates `stripe-customer.ts` picks one up here.
  const stripeCustomerId =
    (await resolveStripeCustomerId({
      secretKey: resolveStripeCredentials(settings.payment?.stripe).secretKey,
      // The order's own customer, not the caller's: a link holder sends no
      // session, and a guest order's id is a cart the resolver declines.
      userId: String(order.customerId || params.customerId || ""),
      email: params.customerEmail || order.guestEmail,
    })) ||
    // Which is why a guest's falls back to the one their checkout minted and
    // stamped on the order — the balance lands on the same Customer as the
    // deposit, so refunds and disputes see one shopper, not two strangers.
    order.stripeCustomerId ||
    undefined;

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ["card"],
      receipt_email: params.customerEmail || order.guestEmail || undefined,
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      description: `Pre-order balance for order #${order.orderNumber}`,
      metadata: {
        kind: PREORDER_BALANCE_CHECKOUT_KIND,
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        userId: String(order.customerId || params.customerId || ""),
        locale: params.locale || "en",
      },
    },
    {
      // The key names the ATTEMPT as well as the amount. Replaying the plain
      // key after a stale intent was released would hand back the very intent
      // that could not be paid — Stripe answers an idempotent create with the
      // original response, cancelled or spent as it may be.
      //
      // Whether a Customer is attached is part of the key too. Stripe refuses
      // a replayed key whose parameters have changed, and the first balance
      // intent a shopper minted after this shipped would otherwise collide
      // with the customer-less one they minted an hour before it — an error
      // shown to someone trying to pay, over a detail that is none of their
      // business.
      idempotencyKey: `${
        staleIntentId
          ? `preorder-balance:${String(order._id)}:${amount}:${currency}:after:${staleIntentId}`
          : `preorder-balance:${String(order._id)}:${amount}:${currency}`
      }${stripeCustomerId ? ":c" : ""}`,
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

  // A pay-later pre-order took no money at checkout, so it carries no payment
  // reference and a `pay_later` method that the custody rule reads as "the
  // vendor holds the cash" (`lib/payments/payment-custody.ts`). Left alone, the
  // ledger would post no cash at all for money the platform is holding, the
  // vendor would never become payable, and the refund path would have no intent
  // to refund. Stripe collected it, so the order is stamped as the card payment
  // it now is.
  //
  // ONLY that order. The test used to be "carries no Stripe intent", which a
  // deposit taken on any other gateway passes just as well — and one can reach
  // here: a legacy Pesapal, PayPal, Razorpay or Paystack deposit order predates
  // the rule that only a card can collect a balance
  // (`lib/payments/deferred-balance.ts`), and its shopper can still pay the
  // balance by card from their order page. Stamped `card`, such an order lost
  // `paymentId` — the other gateway's own reference — to the balance intent,
  // sent every later refund to the Stripe branch, where the deposit sitting on
  // the other gateway could never be reached, and vanished from that gateway's
  // own reversal handling, which looked for it by method. None of the reasons
  // above apply to it: every one of those gateways is already platform custody,
  // and the balance is recorded on `preorderBalancePaymentIntentId` regardless,
  // which is where the Stripe refund webhook looks for it.
  const custodyUpdate =
    order.paymentMethod === "pay_later" && !order.stripePaymentIntentId
      ? {
          paymentMethod: "card",
          paymentId: paymentIntent.id,
          stripePaymentIntentId: paymentIntent.id,
        }
      : {};

  // What Stripe kept of the balance, stamped in the same write that records
  // the payment — the rule every other capture follows (`gatewayFeeUpdate`).
  // Read before the claim so the claim stays a single conditional update, and
  // never allowed to stop it: a store that switched Stripe off between the
  // charge and this webhook still has to record the money it took.
  const feeUpdate = balanceFeeUpdate(
    order,
    await readBalanceFee(settings, paymentIntent.id),
  );

  const claimed = await claimPreorderBalance({
    orderId: order._id,
    reference: paymentIntent.id,
    now,
    extraSet: { ...custodyUpdate, ...feeUpdate },
  });
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

  await runPreorderBalanceSettledEffects({
    claimed,
    settings,
    currency,
    balanceDue,
    gatewayLabel: "Stripe",
    transactionId: paymentIntent.id,
    paymentMetadata: { preorderBalancePaymentIntentId: paymentIntent.id },
  });

  return { settled: true, orderId: String(claimed._id) };
}

/**
 * The claim that decides who settles a balance.
 *
 * ONE conditional update, and that is the entire concurrency story: only an
 * order that is still owed its balance can be claimed, and only once. Every
 * caller — the Stripe webhook, the shopper's confirm call, and an admin
 * recording money that arrived outside any gateway — races through here, and
 * the losers see no document and stop.
 *
 * `reference` is the idempotency key, stored on
 * `preorderBalancePaymentIntentId`. A gateway payment stores its bare intent
 * id there because `POST .../preorder-balance/confirm` matches the client's
 * intent id against it; an offline record stores an `offline:` reference,
 * which no intent id can collide with. That asymmetry is deliberate: if a card
 * payment lands after an admin already recorded the money, the intent will not
 * match, the balance will read as zero, and the capture is refunded rather
 * than collected twice.
 */
export async function claimPreorderBalance(params: {
  orderId: unknown;
  reference: string;
  now: Date;
  /** Custody and fee stamps that only a gateway payment carries. */
  extraSet?: Record<string, unknown>;
}): Promise<BalanceOrder | null> {
  return (await Order.findOneAndUpdate(
    {
      _id: params.orderId,
      status: { $ne: ORDER_STATUS.CANCELLED },
      // Part-paid, or pending on a pay-later order. A deposit order still
      // waiting on its deposit is pending too, and claiming it here marked it
      // paid on the balance alone.
      ...owesPreorderBalanceMatch(),
      $or: [
        { preorderBalancePaidAt: null },
        { preorderBalancePaidAt: { $exists: false } },
      ],
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        preorderBalancePaymentIntentId: params.reference,
        preorderBalancePaidAt: params.now,
        // Every live consignment is now collected — the deposit order left
        // them pending because no vendor had a claim on the deposit.
        "subOrders.$[sub].paymentStatus": PAYMENT_STATUS.PAID,
        "subOrders.$[sub].paidAt": params.now,
        ...(params.extraSet || {}),
      },
      // The first money on the order: a pay-later order's payment IS this one,
      // while a deposit order keeps the day its deposit arrived.
      $min: { paidAt: params.now },
    },
    {
      returnDocument: "after",
      arrayFilters: [{ "sub.status": { $ne: ORDER_STATUS.CANCELLED } }],
    },
  ).lean()) as BalanceOrder | null;
}

/**
 * Everything that has to happen once a balance is genuinely recorded.
 *
 * Shared by the gateway path and the offline path because the money is the
 * same money however it arrived: the charge row grows to the full total, the
 * ledger posts "balance collected" against the receivable raised at deposit
 * time, the things that waited on a fully paid order run, and a pre-order that
 * was only waiting on payment is released for fulfilment.
 *
 * Every step is best-effort and logged rather than thrown: the claim has
 * already committed, so a failure here must not make a recorded payment look
 * unrecorded to the caller.
 */
export async function runPreorderBalanceSettledEffects(params: {
  claimed: BalanceOrder;
  settings: SettingsDocument;
  currency: string;
  balanceDue: number;
  /** Shown in the audit trail — "Stripe", or how the money actually arrived. */
  gatewayLabel: string;
  transactionId: string;
  paymentMetadata: Record<string, unknown>;
  /** Who recorded it. Gateway paths have no human behind them. */
  auditContext?: AuditContext;
}) {
  const { claimed, settings, currency, balanceDue } = params;

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
    paymentMetadata: params.paymentMetadata,
    createdAt: claimed.createdAt,
  }).catch((err) =>
    console.error("Failed to sync pre-order balance transaction:", err),
  );
  const { postOrderPaidSafely } = await import("@/lib/finance/post-events");
  postOrderPaidSafely(claimed._id);

  const { auditOrderPaid, systemActor } = await import("@/lib/orders/audit-order");
  await auditOrderPaid(
    params.auditContext || systemActor(),
    { _id: String(claimed._id), orderNumber: claimed.orderNumber },
    {
      gateway: params.gatewayLabel,
      amount: balanceDue,
      currency,
      transactionId: params.transactionId,
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
      kind: "preorder_balance",
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
    await releaseSettledPreorder(claimed, settings).catch((err) =>
      console.error("Failed to release paid pre-order for fulfilment:", err),
    );
  }
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
      returnDocument: "after",
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

  // Paid in full and released, so it is shippable — queue a label rather than
  // leaving it to the next sweep. Eligibility is judged per consignment inside,
  // and a store with carrier automation switched off is a no-op.
  const { queueAutoShipForOrder } = await import(
    "@/lib/shipping/carriers/shipment-worker"
  );
  await queueAutoShipForOrder(String(order._id)).catch((err) =>
    console.error("Failed to queue auto-ship for a released pre-order:", err),
  );

  // A guest order's `customerId` is its cart, not a user, so the update goes
  // to the address on the order instead of being filed against nobody.
  if (!order.customerId && !order.guestEmail) return;
  const { notifyPreorderCustomerUpdate } = await import("@/lib/notifications/notifications");
  await notifyPreorderCustomerUpdate(
    String(order.customerId || ""),
    order.orderNumber,
    "ready",
    String(order._id),
    {
      releaseDate: order.preorderReleaseDate,
      guestEmail: order.guestEmail,
      settings,
    },
  ).catch((err) =>
    console.error("Failed to notify customer of released pre-order:", err),
  );
}


/**
 * Record a pre-order balance that arrived outside any gateway.
 *
 * The escape hatch for money the store cannot collect online. A deposit
 * pre-order can be placed on any gateway, but only Stripe can be charged again
 * for the balance (`lib/payments/deferred-balance.ts` now stops new ones), so
 * every store that took deposits on another gateway has orders sitting
 * `partially_paid` with no way forward. The shopper pays by transfer, cash or
 * a fresh gateway link, and an admin writes down what happened here.
 *
 * It settles through exactly the same claim and the same side effects as a
 * card payment, because it is the same event: the order is fully paid, the
 * ledger clears its receivable, and a pre-order that was only waiting on money
 * is released for fulfilment. What it deliberately does NOT do is touch
 * `paymentMethod` — that field answers "who is holding the cash" for every
 * payout in the marketplace (`lib/payments/payment-custody.ts`), and the
 * deposit's own gateway already answered it correctly.
 */
export async function recordPreorderBalanceOffline(params: {
  orderId: string;
  amount: number;
  /** How the money arrived — shown in the audit trail. */
  method: string;
  /** The admin's own receipt reference; also the idempotency key. */
  reference: string;
  receivedAt?: Date;
  note?: string;
  auditContext: AuditContext;
  settings?: SettingsDocument;
}): Promise<{ orderNumber: string; amount: number; currency: string }> {
  if (!Types.ObjectId.isValid(params.orderId)) {
    throw new ValidationError("Order not found");
  }
  const order = (await Order.findById(params.orderId).lean()) as BalanceOrder | null;
  if (!order) throw new ValidationError("Order not found");

  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    throw new ValidationError("There is no balance due on this order");
  }

  const settings = params.settings || (await getSettings());
  const currency = orderCurrency(order, settings);
  const reference = params.reference.trim();
  if (!reference) {
    throw new ValidationError({
      reference: ["A payment reference is required"],
    });
  }

  // The whole balance or nothing. A part payment would mark the order paid
  // while it is not, and there is no second record to reconcile the remainder
  // against — the gateway path refuses a mismatched amount for the same reason.
  if (
    toStripeAmount(params.amount, currency) !== toStripeAmount(balanceDue, currency)
  ) {
    throw new ValidationError({
      amount: [
        `Record the whole balance of ${balanceDue.toFixed(2)} ${currency}`,
      ],
    });
  }

  // "Received" does not say received BY WHOM, and in marketplace mode that is
  // the difference between owing the vendor a payout and being owed a
  // commission. An order whose deposit went through the platform's own gateway
  // has already answered it. One with no gateway behind it (a pay-later
  // pre-order carries none) would be silently filed as the vendor's cash, so
  // it is refused rather than guessed at.
  if (settings.multiVendorMode?.enabled && !isPlatformSettled(order)) {
    throw new ValidationError(
      "No gateway payment stands behind this order, so recording the balance here would credit the wrong side of the marketplace ledger. Settle it through the vendor's payout instead.",
    );
  }

  const claimed = await claimPreorderBalance({
    orderId: order._id,
    // `offline:` keeps it out of the namespace of Stripe intent ids, so a card
    // payment that lands afterwards cannot mistake this for its own record —
    // it finds no balance due and refunds itself.
    reference: `${OFFLINE_BALANCE_REFERENCE_PREFIX}${reference}`,
    now: params.receivedAt || new Date(),
  });
  if (!claimed) {
    throw new ValidationError(
      "This balance was settled by someone else while you were recording it. Reload the order to see where it stands.",
    );
  }

  await runPreorderBalanceSettledEffects({
    claimed,
    settings,
    currency,
    balanceDue,
    gatewayLabel: params.method,
    transactionId: reference,
    paymentMetadata: {
      preorderBalanceOfflineReference: reference,
      preorderBalanceOfflineMethod: params.method,
      ...(params.note ? { preorderBalanceOfflineNote: params.note } : {}),
    },
    auditContext: params.auditContext,
  });

  return { orderNumber: claimed.orderNumber, amount: balanceDue, currency };
}
