import { CheckoutAttempt, CHECKOUT_ATTEMPT_STATUS, Order } from "@/models";
import { connectDB } from "@/lib/db";
import { getSettings, type ISettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  resolveIotecCredentials,
  resolvePayPalCredentials,
  resolvePaystackCredentials,
  resolvePesapalCredentials,
  resolveRazorpayCredentials,
} from "@/lib/settings/credentials";
import { getPayPalOrderStatus } from "@/lib/payments/paypal";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  STRIPE_FEE_EXPAND,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { finalizeStripePaymentIntentOrder } from "@/lib/payments/stripe-orders";
import { finalizePayPalOrder } from "@/lib/payments/paypal-orders";
import {
  fetchRazorpayOrderPayments,
  getRazorpayCredentials,
} from "@/lib/payments/razorpay";
import { finalizeRazorpayOrder } from "@/lib/payments/razorpay-orders";
import {
  getPaystackCredentials,
  verifyPaystackTransaction,
} from "@/lib/payments/paystack";
import { finalizePaystackOrder } from "@/lib/payments/paystack-orders";
import {
  getPesapalCredentials,
  getPesapalTransactionState,
  getPesapalTransactionStatus,
} from "@/lib/payments/pesapal";
import { finalizePesapalOrder } from "@/lib/payments/pesapal-orders";
import {
  getIotecCredentials,
  getIotecTransactionState,
  getIotecTransactionStatusByExternalId,
} from "@/lib/payments/iotec";
import { finalizeIotecOrder } from "@/lib/payments/iotec-orders";
import { recordChargeFailure } from "@/lib/payments/payment-transactions";
import { releaseAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { closeCheckoutAttempt } from "@/lib/checkout/checkout-attempt-store";
import {
  retireCheckoutAttempt,
  wasSupersededByLaterPurchase,
} from "@/lib/checkout/superseded-orders";
import { recordCheckoutPaymentEvent } from "@/lib/orders/abandoned-checkouts";

/**
 * Close out checkouts that went to a gateway and never came back.
 *
 * Every redirect and mobile-money path writes the order BEFORE the shopper
 * leaves, and nothing has ever tidied up the ones who did not return. Those
 * rows stay `pending / pending` for ever: they were counted as orders in the
 * admin, listed to the vendor, and shown to the shopper as an order they
 * never placed.
 *
 * **Ask before deciding.** The tempting shortcut is "a pending gateway order
 * holds nothing, so cancelling it is free". That is true of stock and false of
 * money. Paystack charges the card the moment the shopper confirms; Razorpay
 * can hand back a payment already `captured`; ioTec and mobile money have no
 * refund API at all, so a payment written off here is one a person has to send
 * back by hand. And if the webhook went missing, this sweep is the only thing
 * left that would notice the money. So every candidate is put to its own
 * gateway first, and only a gateway that says "never paid" ends the order.
 *
 * Three outcomes, and the third is the important one:
 *
 *  - **paid** — finalize through the gateway's own finalizer, exactly as the
 *    shopper's return would have. The order completes, days late.
 *  - **unpaid** — the gateway is certain: voided, failed, reversed, or an id
 *    it has never heard of. `paymentStatus` becomes `expired`.
 *  - **unknown** — still pending, a 5xx, a timeout, an authorization nobody
 *    has captured. **Nothing happens.** The row is stamped as checked and
 *    comes round again next run; after {@link ATTENTION_AFTER_MS} it is
 *    reported so a person can look at it. An order is never expired on
 *    silence.
 *
 * `expired` rather than `cancelled` on purpose: cancelled means a person
 * called the order off, and it is the word the store's own cancellation rate
 * is built from. See `PAYMENT_STATUS.EXPIRED`.
 *
 * Mobile money (MTN, Orange) is swept by its own reconcilers, which already
 * ask the network every fifteen minutes and stamp `paymentReconcileClosedAt`
 * on the ones that definitively failed. This job only reads that stamp rather
 * than asking a second time with a second set of rules.
 */

/**
 * How long a shopper gets to come back, per gateway.
 *
 * This is when the sweep first ASKS, not when it writes anything off: an
 * answer short of a definite "never paid" changes nothing however old the
 * order is. So a short window costs an API call and buys an earlier rescue.
 */
const EXPIRY_WINDOW_MS: Record<string, number> = {
  // Half an hour, far shorter than the rest, and only because of the capture
  // below: PayPal honours a buyer's approval for about three hours, so an
  // order still `APPROVED` at 24 h is money that can no longer be taken. The
  // shopper agreed, and the sweep is the last thing standing between that and
  // a lost sale.
  paypal: 30 * 60 * 1000,
  razorpay: 24 * 60 * 60 * 1000,
  paystack: 24 * 60 * 60 * 1000,
  // Pesapal's own checkout session is short, and the app already reuses an
  // attempt for only an hour (`REUSABLE_ATTEMPT_METHODS`).
  pesapal: 60 * 60 * 1000,
  // A push the payer never answered. Six hours is a compromise: long enough
  // for a phone that was off all morning, short enough that goods are not held
  // for a day by a prompt nobody will ever answer — these orders hold their
  // stock from the moment they are written (`async-push-inventory.ts`). The
  // sweep still refuses to expire any of them without a definite answer from
  // the provider, so a slow network costs a wait, never a lost sale.
  iotec: 6 * 60 * 60 * 1000,
  mtn_momo: 6 * 60 * 60 * 1000,
  orange_money: 6 * 60 * 60 * 1000,
  // Cards never wrote a pending order, so this window only reaches checkout
  // ATTEMPTS — an intent the shopper walked away from, or one whose capture
  // webhook went missing. A day is plenty: Stripe keeps an unconfirmed intent
  // alive far longer than a shopper's patience.
  card: 24 * 60 * 60 * 1000,
};

/** After this long with no answer either way, a person should look. */
const ATTENTION_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How recent an order must be for its expiry to email the shopper a way to pay.
 *
 * The sweep's first runs after an upgrade — and every run of
 * `retire-stale-gateway-orders.ts` — reach back as far as there are pending
 * rows, which on a store that has run for a year is a year of checkouts left at
 * a gateway. Mailing those would send months-old prices to shoppers who moved
 * on long ago, hundreds in an afternoon, each a link that honours them. Past
 * this the order is expired quietly — the abandoned-checkout ladder skips
 * checkouts older than a week for the same reason — and a person can still
 * send a link from the order page.
 */
const PAYMENT_FAILED_EMAIL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long PayPal honours a buyer's approval. Past it a capture is refused,
 * so the sweep stops trying and leaves the order for a person.
 */
const PAYPAL_CAPTURE_DEADLINE_MS = 3 * 60 * 60 * 1000;

type ExpiryCandidate = {
  _id: unknown;
  orderNumber?: string;
  paymentMethod?: string;
  total?: number;
  currency?: string;
  createdAt?: Date;
  checkoutCartId?: unknown;
  paypalOrderId?: string;
  razorpayOrderId?: string;
  paystackReference?: string;
  pesapalOrderTrackingId?: string;
  pesapalMerchantReference?: string;
  iotecExternalId?: string;
  iotecTransactionId?: string;
  stripePaymentIntentId?: string;
  paymentReconcileClosedAt?: Date | null;
};

/** A dry run asks the gateway and writes nothing — not even a settlement. */
type ProbeContext = { dryRun: boolean };

type ProbeOutcome =
  /** Settled by the probe — the finalizer has already run. */
  | { outcome: "paid" }
  /** The gateway is certain no money arrived. */
  | { outcome: "unpaid"; reason: string }
  /** Still open, or the gateway could not be asked. */
  | { outcome: "unknown" };

const UNKNOWN: ProbeOutcome = { outcome: "unknown" };

type CheckoutExpiryResult = {
  checked: number;
  finalized: number;
  expired: number;
  /**
   * Of those expired, the ones whose cart had been bought some other way:
   * cancelled with it, and not offered a way to pay.
   */
  superseded: number;
  unknown: number;
  failed: number;
  /** Undecided for longer than a week — a human has to chase these. */
  needingAttention: Array<{ orderNumber: string; paymentMethod: string }>;
};

async function probePayPal(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  if (!order.paypalOrderId) return { outcome: "unpaid", reason: "no_reference" };
  const creds = resolvePayPalCredentials(settings.payment?.paypal);
  if (!creds.clientId || !creds.clientSecret) return UNKNOWN;

  const { status } = await getPayPalOrderStatus({
    creds: {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      mode: creds.mode,
    },
    orderId: order.paypalOrderId,
  });

  if (status === "COMPLETED") {
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizePayPalOrder({
      paypalOrderId: order.paypalOrderId,
      creds: {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        mode: creds.mode,
      },
      settings,
      // The money is PayPal's record, not ours to take again.
      alreadyCaptured: true,
    });
    return { outcome: "paid" };
  }
  if (status === "VOIDED" || status === "NOT_FOUND") {
    return { outcome: "unpaid", reason: status.toLowerCase() };
  }
  // APPROVED — the shopper agreed on PayPal's page and never came back: the
  // tab was closed, the connection dropped, the phone slept. PayPal will
  // honour that approval for about three hours and then stop, so this is the
  // one window in which the sale can still be saved.
  //
  // **The webhook is what normally settles this, and the browser's return
  // before it. This runs only for what both missed** — the candidates are
  // orders still `pending` half an hour on, so anything either path handled
  // has already left this queue. The capture itself is the same
  // `finalizePayPalOrder` they call, which is guarded and idempotent: the two
  // landing together still record one payment.
  if (status === "APPROVED") {
    const age = Date.now() - new Date(order.createdAt || Date.now()).getTime();
    if (age > PAYPAL_CAPTURE_DEADLINE_MS) {
      // Past PayPal's own deadline. Not a refusal — PayPal has not said the
      // order failed — so it is left alone and reported rather than written
      // off, and a person decides in PayPal's dashboard.
      return UNKNOWN;
    }
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizePayPalOrder({
      paypalOrderId: order.paypalOrderId,
      creds: {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        mode: creds.mode,
      },
      settings,
      // Not `alreadyCaptured`: here the finalizer is the one taking the money.
    });
    return { outcome: "paid" };
  }
  return UNKNOWN;
}

async function probeRazorpay(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  if (!order.razorpayOrderId) {
    return { outcome: "unpaid", reason: "no_reference" };
  }
  let creds;
  try {
    creds = getRazorpayCredentials(
      resolveRazorpayCredentials(settings.payment?.razorpay),
    );
  } catch {
    return UNKNOWN;
  }

  const payments = await fetchRazorpayOrderPayments({
    creds,
    razorpayOrderId: order.razorpayOrderId,
  });

  // A shopper who tries three cards leaves three payments on one order, so the
  // one that got through is looked for rather than the first one listed.
  const settled = payments.find(
    (payment) =>
      payment.status === "captured" || payment.status === "authorized",
  );
  if (settled) {
    // Passing the credentials lets the finalizer capture an authorization,
    // which is what the shopper's own return does with the same payment.
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizeRazorpayOrder({
      razorpayOrderId: order.razorpayOrderId,
      payment: settled,
      creds,
      settings,
    });
    return { outcome: "paid" };
  }
  if (payments.length === 0) {
    return { outcome: "unpaid", reason: "never_attempted" };
  }
  if (payments.every((payment) => payment.status === "failed")) {
    return { outcome: "unpaid", reason: "all_attempts_failed" };
  }
  return UNKNOWN;
}

async function probePaystack(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  if (!order.paystackReference) {
    return { outcome: "unpaid", reason: "no_reference" };
  }
  const paystack = resolvePaystackCredentials(settings.payment?.paystack);
  if (!paystack.secretKey) return UNKNOWN;
  const creds = getPaystackCredentials({
    publicKey: paystack.publicKey,
    secretKey: paystack.secretKey,
  });

  const transaction = await verifyPaystackTransaction({
    creds,
    reference: order.paystackReference,
  });
  const status = String(transaction.status || "").toLowerCase();

  if (status === "success") {
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizePaystackOrder({
      reference: order.paystackReference,
      transaction,
      settings,
      customerEmail: transaction.customer?.email,
    });
    return { outcome: "paid" };
  }
  // Paystack charges the card immediately, so these two are the only answers
  // that mean the money is certainly not coming.
  if (status === "failed" || status === "abandoned") {
    return { outcome: "unpaid", reason: status };
  }
  return UNKNOWN;
}

async function probePesapal(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  if (!order.pesapalOrderTrackingId) {
    return { outcome: "unpaid", reason: "no_reference" };
  }
  let creds;
  try {
    creds = getPesapalCredentials(
      resolvePesapalCredentials(settings.payment?.pesapal),
    );
  } catch {
    return UNKNOWN;
  }

  const transaction = await getPesapalTransactionStatus({
    creds,
    orderTrackingId: order.pesapalOrderTrackingId,
  });
  const state = getPesapalTransactionState(transaction);

  if (state === "completed") {
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizePesapalOrder({
      orderTrackingId: order.pesapalOrderTrackingId,
      merchantReference: order.pesapalMerchantReference,
      transaction,
      settings,
    });
    return { outcome: "paid" };
  }
  if (state === "failed" || state === "invalid" || state === "reversed") {
    return { outcome: "unpaid", reason: state };
  }
  return UNKNOWN;
}

async function probeIotec(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  if (!order.iotecExternalId) {
    return { outcome: "unpaid", reason: "no_reference" };
  }
  let creds;
  try {
    creds = getIotecCredentials(resolveIotecCredentials(settings.payment?.iotec));
  } catch {
    return UNKNOWN;
  }

  const transaction = await getIotecTransactionStatusByExternalId({
    creds,
    externalId: order.iotecExternalId,
  });
  const state = getIotecTransactionState(transaction);

  if (state === "completed") {
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizeIotecOrder({
      transactionId: String(order.iotecTransactionId || ""),
      externalId: order.iotecExternalId,
      transaction,
      settings,
    });
    return { outcome: "paid" };
  }
  if (state === "failed" || state === "invalid") {
    return { outcome: "unpaid", reason: state };
  }
  return UNKNOWN;
}

/**
 * MTN and Orange, read off their own reconcilers' verdict rather than asked
 * again here. `paymentReconcileClosedAt` is stamped when the network has said
 * the request failed, or has never heard of the reference.
 */
function probeReconciledMobileMoney(order: ExpiryCandidate): ProbeOutcome {
  if (order.paymentReconcileClosedAt) {
    return { outcome: "unpaid", reason: "reconciler_closed" };
  }
  return UNKNOWN;
}

/**
 * A card attempt nobody finished.
 *
 * Only ever reached through the ATTEMPT sweep: Stripe writes no order until
 * the money is captured, so there has never been a pending order here to
 * chase. `succeeded` means a capture whose webhook went missing — the same
 * finalizer the webhook would have run puts it right. `canceled` is Stripe
 * saying the intent is dead, which is the only definite "never paid" it gives.
 */
async function probeStripeCard(
  order: ExpiryCandidate,
  settings: ISettings,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  const intentId = String(order.stripePaymentIntentId || "");
  if (!intentId) return { outcome: "unpaid", reason: "no_reference" };

  const stripeSettings = settings.payment?.stripe;
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!stripeSettings?.enabled || !isStripeSecretKeyConfigured(secretKey)) {
    return UNKNOWN;
  }

  const intent = await getStripeForSecretKey(secretKey).paymentIntents.retrieve(
    intentId,
    { expand: [STRIPE_FEE_EXPAND] },
  );

  if (intent.status === "succeeded") {
    if (ctx.dryRun) return { outcome: "paid" };
    await finalizeStripePaymentIntentOrder(intent, settings);
    return { outcome: "paid" };
  }
  if (intent.status === "canceled") {
    return { outcome: "unpaid", reason: "canceled" };
  }
  // requires_payment_method after a refusal, requires_confirmation, processing:
  // all still live as far as Stripe is concerned.
  return UNKNOWN;
}

const PROBES: Record<
  string,
  (
    order: ExpiryCandidate,
    settings: ISettings,
    ctx: ProbeContext,
  ) => Promise<ProbeOutcome>
> = {
  paypal: probePayPal,
  razorpay: probeRazorpay,
  paystack: probePaystack,
  pesapal: probePesapal,
  iotec: probeIotec,
  card: probeStripeCard,
  mtn_momo: async (order) => probeReconciledMobileMoney(order),
  orange_money: async (order) => probeReconciledMobileMoney(order),
};

/**
 * Which rows the sweep may touch — its own function so the rule can be read
 * and tested without a database.
 *
 * Three guards, and the third was learned the hard way. A run against the dev
 * database marked a SHIPPED order `expired` because its PayPal reference was
 * 51 days old and PayPal had forgotten it: the goods were with the customer,
 * and the order vanished from the store's reports as though nobody had ever
 * placed it. So the sweep only ever looks at an order that has not moved
 * towards the shopper. `pending` and `preordered` are the states an unpaid
 * checkout sits in by itself; anything else — processing, shipped, delivered,
 * cancelled — means a PERSON acted on it, and their decision outranks a
 * tidy-up job's.
 */
export function staleCandidateFilter(params: {
  now: number;
  olderThanMs?: number;
  paymentMethods?: string[];
}): Record<string, unknown> | null {
  const wanted = new Set(
    (params.paymentMethods || []).map((method) => method.trim().toLowerCase()),
  );
  // One query for all the gateways, each with its own cutoff: a Pesapal
  // checkout is stale after an hour and a MoMo push is not stale for two days.
  const methodWindows = Object.entries(EXPIRY_WINDOW_MS)
    .filter(([paymentMethod]) => wanted.size === 0 || wanted.has(paymentMethod))
    .map(([paymentMethod, windowMs]) => ({
      paymentMethod,
      createdAt: {
        $lt: new Date(params.now - (params.olderThanMs ?? windowMs)),
      },
    }));
  if (methodWindows.length === 0) return null;

  return {
    // A settled order is `paid`, a written-off one `expired`, and a deposit
    // `partially_paid` — so this alone keeps the sweep off every order whose
    // money has already been accounted for.
    paymentStatus: PAYMENT_STATUS.PENDING,
    status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.PREORDERED] },
    $or: methodWindows,
  };
}

type ExpireStaleOptions = {
  /** Gateway calls one run may make. */
  limit?: number;
  /**
   * Ask every gateway and write nothing — no expiry, no restock, no
   * settlement, not even the "asked at" stamp. What the migration script runs
   * before anyone presses apply.
   */
  dryRun?: boolean;
  /**
   * Overrides every gateway's own window with a single cutoff. The cron wants
   * the per-gateway windows; a migration wants "everything older than a week,
   * whatever gateway it is".
   */
  olderThanMs?: number;
  /** Narrows the sweep to these gateways — one gateway's migration at a time. */
  paymentMethods?: string[];
};

/**
 * One pass. `limit` caps the gateway calls a single run makes, so a backlog
 * is worked through over several runs instead of in one long request.
 *
 * The cron calls this with nothing but a limit. `scripts/retire-stale-gateway-orders.ts`
 * calls it with the other three, which is the whole reason they exist: the
 * migration must be able to rehearse itself, be pointed at one gateway, and
 * reach rows far older than the cron's window — without a second copy of this
 * logic that could drift from it.
 */
export async function expireStalePaymentOrders(
  options: ExpireStaleOptions = {},
): Promise<CheckoutExpiryResult> {
  const { limit = 50, dryRun = false, olderThanMs, paymentMethods } = options;
  await connectDB();
  const settings = await getSettings();

  const result: CheckoutExpiryResult = {
    checked: 0,
    finalized: 0,
    expired: 0,
    superseded: 0,
    unknown: 0,
    failed: 0,
    needingAttention: [],
  };

  const now = Date.now();
  const filter = staleCandidateFilter({ now, olderThanMs, paymentMethods });
  if (!filter) return result;

  const candidates = await Order.find(filter)
    // Least recently asked first, so a backlog cannot starve newer orders —
    // the ordering the MoMo reconciler settled on for the same reason.
    .sort({ paymentReconcileCheckedAt: 1, createdAt: 1 })
    .select(
      "_id orderNumber paymentMethod total currency createdAt checkoutCartId " +
        "paypalOrderId razorpayOrderId paystackReference pesapalOrderTrackingId " +
        "pesapalMerchantReference iotecExternalId iotecTransactionId " +
        "paymentReconcileClosedAt",
    )
    .limit(limit)
    .lean<ExpiryCandidate[]>();

  for (const order of candidates) {
    const method = String(order.paymentMethod || "");
    const probe = PROBES[method];
    if (!probe) continue;

    result.checked++;
    if (!dryRun) {
      await Order.updateOne(
        { _id: order._id },
        { $set: { paymentReconcileCheckedAt: new Date() } },
      );
    }

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(order, settings, { dryRun });
    } catch (error) {
      // The gateway's API is down, or the network is. Not an answer, so the
      // order keeps its place in the queue and is asked again next run.
      result.failed++;
      console.error(
        `Checkout expiry probe failed for order ${order.orderNumber || order._id}:`,
        error,
      );
      continue;
    }

    if (outcome.outcome === "paid") {
      result.finalized++;
      continue;
    }

    if (outcome.outcome === "unknown") {
      result.unknown++;
      const age = now - new Date(order.createdAt || now).getTime();
      if (age > ATTENTION_AFTER_MS) {
        result.needingAttention.push({
          orderNumber: String(order.orderNumber || order._id),
          paymentMethod: method,
        });
      }
      continue;
    }

    // Bought some other way while this order waited — by card, say, while a
    // mobile-money push sat unanswered, since a push that may still be
    // approved is never cancelled. Written off like any other, but retired
    // with it and not mailed: offering to collect it now would sell the
    // shopper the same goods twice.
    const superseded = await wasSupersededByLaterPurchase(order).catch(
      (error) => {
        console.error(
          `Failed to check whether order ${order.orderNumber || order._id} was superseded:`,
          error,
        );
        return false;
      },
    );

    if (dryRun) {
      result.expired++;
      if (superseded) result.superseded++;
      continue;
    }

    // Guarded on the payment status it was read with: a webhook that landed
    // while the gateway was being asked has already settled this order, and
    // must not be overwritten by an answer that is now out of date.
    const updated = await Order.updateOne(
      { _id: order._id, paymentStatus: PAYMENT_STATUS.PENDING },
      {
        $set: {
          paymentStatus: PAYMENT_STATUS.EXPIRED,
          paymentReconcileClosedAt: new Date(),
        },
      },
    );
    if (!updated.modifiedCount) continue;

    result.expired++;
    if (superseded && (await retireCheckoutAttempt(order._id))) {
      result.superseded++;
    }
    // Back on the shelf. Claim-based, so an order that held nothing — every
    // redirect gateway — is a no-op.
    await releaseAsyncPushInventory(order._id);
    await recordChargeFailure({
      provider: method,
      paymentMethod: method,
      amount: order.total,
      currency: order.currency,
      failureCode: outcome.reason,
      gatewayMessage: "The payment window closed with no payment received.",
      source: "reconcile",
      status: "cancelled",
      orderId: order._id,
      orderNumber: order.orderNumber,
      dedupeKey: `expiry:${String(order._id)}`,
    });
    await recordCheckoutPaymentEvent({
      cartId: order.checkoutCartId,
      gateway: method,
      status: "cancelled",
      message: superseded
        ? `Checkout expired (${outcome.reason}); the cart was bought another way`
        : `Checkout expired (${outcome.reason})`,
    });
    // And tell the shopper, with a way to pay. Until this, the customer's side
    // of a failed mobile-money push was silence: an order that said "payment
    // pending" for ever and goods that never came. The order is still theirs —
    // same number, same prices — so the email offers to finish it rather than
    // announcing a loss. See `lib/payments/order-pay.ts`. Only while that is
    // still news — see `PAYMENT_FAILED_EMAIL_MAX_AGE_MS`.
    const orderAge = now - new Date(order.createdAt || now).getTime();
    if (!superseded && orderAge <= PAYMENT_FAILED_EMAIL_MAX_AGE_MS) {
      const { sendOrderPaymentFailedEmail } = await import(
        "@/lib/orders/order-payment-failed-email"
      );
      await sendOrderPaymentFailedEmail({ orderId: order._id });
    }
  }

  return result;
}

/**
 * The same sweep, for checkout attempts.
 *
 * An attempt is what a switched-over gateway writes instead of a pending
 * order, so the rows this has to chase are in another collection — but the
 * question is identical and so is the answer, which is why it shares the probe
 * registry above rather than restating seven gateways' rules. What differs is
 * only the bookkeeping: an attempt is closed as `expired` rather than having a
 * payment status written on it, and it holds no stock to give back (the goods
 * are never taken until there is an order).
 *
 * Runs in the same cron as the order sweep, after it.
 */
export async function expireStaleCheckoutAttempts(
  options: ExpireStaleOptions = {},
): Promise<CheckoutExpiryResult> {
  const { limit = 50, dryRun = false, olderThanMs, paymentMethods } = options;
  await connectDB();
  const settings = await getSettings();

  const result: CheckoutExpiryResult = {
    checked: 0,
    finalized: 0,
    expired: 0,
    superseded: 0,
    unknown: 0,
    failed: 0,
    needingAttention: [],
  };

  const now = Date.now();
  const wanted = new Set(
    (paymentMethods || []).map((method) => method.trim().toLowerCase()),
  );
  const methods = Object.keys(EXPIRY_WINDOW_MS).filter(
    (method) => wanted.size === 0 || wanted.has(method),
  );
  if (methods.length === 0) return result;

  const attempts = await CheckoutAttempt.find({
    status: CHECKOUT_ATTEMPT_STATUS.OPEN,
    paymentMethod: { $in: methods },
    // An attempt says itself when it stops being worth returning to, so unlike
    // an order there is no per-gateway window to reconstruct here — except
    // when a migration asks for one.
    ...(olderThanMs
      ? { createdAt: { $lt: new Date(now - olderThanMs) } }
      : { expiresAt: { $lt: new Date(now) } }),
  })
    .sort({ "reconcile.checkedAt": 1, createdAt: 1 })
    .select("_id paymentMethod gateway snapshot createdAt reconcile cartId")
    .limit(limit)
    .lean<
      Array<{
        _id: unknown;
        paymentMethod?: string;
        gateway?: Record<string, unknown>;
        snapshot?: { total?: number; currency?: string };
        createdAt?: Date;
        cartId?: unknown;
      }>
    >();

  for (const attempt of attempts) {
    const method = String(attempt.paymentMethod || "");
    const probe = PROBES[method];
    if (!probe) continue;

    result.checked++;
    if (!dryRun) {
      await CheckoutAttempt.updateOne(
        { _id: attempt._id },
        { $set: { "reconcile.checkedAt": new Date() } },
      );
    }

    // The probes read a gateway reference off a flat object and settle through
    // the gateway's own finalizer, which finds the attempt by that same
    // reference — so an attempt shaped like an order is all they need.
    const candidate: ExpiryCandidate = {
      _id: attempt._id,
      paymentMethod: method,
      total: attempt.snapshot?.total,
      currency: attempt.snapshot?.currency,
      createdAt: attempt.createdAt,
      ...(attempt.gateway || {}),
    };

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(candidate, settings, { dryRun });
    } catch (error) {
      result.failed++;
      console.error(
        `Checkout attempt probe failed for ${String(attempt._id)}:`,
        error,
      );
      continue;
    }

    if (outcome.outcome === "paid") {
      // The probe's finalizer promoted it; nothing left to do.
      result.finalized++;
      continue;
    }

    if (outcome.outcome === "unknown") {
      result.unknown++;
      const age = now - new Date(attempt.createdAt || now).getTime();
      if (age > ATTENTION_AFTER_MS) {
        result.needingAttention.push({
          orderNumber: String(attempt._id),
          paymentMethod: method,
        });
      }
      continue;
    }

    if (dryRun) {
      result.expired++;
      continue;
    }

    const closed = await closeCheckoutAttempt(
      attempt._id,
      CHECKOUT_ATTEMPT_STATUS.EXPIRED,
    );
    if (!closed) continue;

    result.expired++;
    await recordChargeFailure({
      provider: method,
      paymentMethod: method,
      amount: attempt.snapshot?.total,
      currency: attempt.snapshot?.currency,
      failureCode: outcome.reason,
      gatewayMessage: "The payment window closed with no payment received.",
      source: "reconcile",
      status: "cancelled",
      checkoutAttemptId: attempt._id,
      dedupeKey: `attempt-expiry:${String(attempt._id)}`,
    });
    // On the checkout's payment timeline too, as an expired order is: the
    // attempt path left it saying "payment started" for good.
    await recordCheckoutPaymentEvent({
      cartId: attempt.cartId,
      gateway: method,
      status: "cancelled",
      message: `Checkout expired (${outcome.reason})`,
    });
  }

  return result;
}
