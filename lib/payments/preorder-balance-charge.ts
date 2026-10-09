import { Types } from "mongoose";
import type Stripe from "stripe";
import { Order, User } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { PREORDER_ITEM_STATUS } from "@/lib/orders/preorders";
import {
  collectionScope,
  cycleMismatch,
  type ScopeSubOrder,
} from "@/lib/orders/preorder-scope";
import { findStaleTermsLines } from "@/lib/orders/preorder-terms";
import {
  PREORDER_BALANCE_CHECKOUT_KIND,
  settlePreorderBalanceFromIntent,
} from "@/lib/payments/preorder-balance";

/**
 * Taking the pre-order balance off the card the shopper left with us — only
 * once they have been told, and only for the request they were told about.
 *
 * The card-on-file chain (the Customer in `stripe-customer.ts`, the card saved
 * at checkout, the mandate in `preorder-mandate.ts`) ends here. What changed is
 * WHEN it may be used. The request paths used to charge the moment a balance
 * was asked for; the mandate promised the shopper would hear first, and the
 * shopper heard afterwards, if at all. Now a charge needs a collection cycle
 * (`lib/orders/preorder-collection.ts`) whose advance notice the mail server
 * accepted, whose notice window (`chargeNotBefore`) has passed, and which
 * still describes the order: the same consignments, amount, currency and
 * readiness, every consignment's stock allocated, no product date waiting to
 * be carried to it. Every caller — the scheduled pass, a retry, anything else
 * — goes through {@link preorderBalanceChargeEligibility} and then a claim
 * that re-checks the same conditions in the database at the moment of
 * charging.
 *
 * **It is an attempt, never a guarantee.** An off-session charge fails in ways
 * an on-session one does not — the card expired during a six-month lead time,
 * the bank wants the shopper present for 3-D Secure, the funds are not there.
 * Every refusal ends with the shopper told and pointed at the page where they
 * can pay it themselves. And an attempt whose ANSWER was lost — a timeout, a
 * dropped connection — is never read as a refusal: the next run asks Stripe
 * what happened to that exact attempt before anything else is tried.
 *
 * Retries keep their old shape — at most {@link PREORDER_BALANCE_MAX_ATTEMPTS}
 * per request, {@link PREORDER_BALANCE_RETRY_HOURS} apart — and all fall under
 * the one notice of the request they belong to: same amount, same request,
 * the shopper told after every failure. A changed amount or scope is a NEW
 * request with its own notice and its own attempts.
 */

/** How long a failed attempt waits before the next may be made. */
export const PREORDER_BALANCE_RETRY_HOURS = 24;

/** Attempts per request, counting the first. */
export const PREORDER_BALANCE_MAX_ATTEMPTS = 3;

const HOUR_MS = 60 * 60 * 1000;
/**
 * How long an attempt whose answer was lost is left alone before Stripe's
 * silence is read as "never received" — Stripe gives up on a request well
 * inside this, so a request still on its way cannot be mistaken for none.
 */
const UNCONFIRMED_ATTEMPT_SETTLE_MS = 10 * 60 * 1000;

/**
 * Stripe codes no retry gets past: the bank is asking for the shopper.
 */
const NEEDS_THE_SHOPPER_CODES: ReadonlySet<string> = new Set([
  "authentication_required",
  "requires_action",
]);

type ChargeableOrder = {
  _id?: unknown;
  orderNumber?: string;
  currency?: string;
  customerId?: unknown;
  guestEmail?: string;
  preorderReleaseDate?: Date;
  preorderBalanceRequestedAt?: Date;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string | null;
  total?: number;
  preorderStatus?: string;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  preorderMandateAcceptedAt?: Date | null;
  preorderSavedPaymentMethodId?: string | null;
  /** The Customer that card was saved against — see the order model. */
  stripeCustomerId?: string | null;
  preorderBalanceChargeAttempts?: number | null;
  preorderBalanceLastChargeAt?: Date | null;
  preorderBalanceLastChargeCode?: string | null;
  preorderBalanceChargeOutcome?: string | null;
  preorderBalanceChargeKey?: string | null;
  preorderReadinessRevision?: number | null;
  preorderCollection?: {
    cycleId?: string | null;
    state?: string | null;
    scopeSubOrderIds?: unknown[] | null;
    amount?: number | null;
    currency?: string | null;
    readinessRevision?: number | null;
    autoCharge?: boolean | null;
    chargeNotBefore?: Date | null;
    notice?: { acceptedAt?: Date | null; bounced?: boolean | null } | null;
  } | null;
  subOrders?: Array<
    ScopeSubOrder & {
      items?: Array<{
        purchaseType?: string;
        quantity?: number;
        preorderOutstandingAmount?: number | null;
      }> | null;
    }
  > | null;
};

type ChargeEligibility =
  | { chargeable: true; cycleId: string }
  | { chargeable: false; reason: string };

function orderCurrency(order: ChargeableOrder, fallback?: string) {
  return String(order.currency || fallback || "USD").trim().toUpperCase();
}

/**
 * Whether this order may be charged off-session right now — the one rule.
 *
 * Pure: the scheduled pass narrows candidates with a query, but this decides,
 * and the charge itself re-checks it under a claim.
 */
export function preorderBalanceChargeEligibility(
  order: ChargeableOrder,
  now: Date = new Date(),
  fallbackCurrency?: string,
): ChargeEligibility {
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) {
    return { chargeable: false, reason: "The order was cancelled" };
  }
  if (order.preorderStatus !== PREORDER_ITEM_STATUS.PAYMENT_DUE) {
    return { chargeable: false, reason: "The balance has not been asked for" };
  }
  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) return { chargeable: false, reason: "No balance is due" };
  if (!order.preorderSavedPaymentMethodId) {
    return { chargeable: false, reason: "No card was saved for this order" };
  }
  if (!order.preorderMandateAcceptedAt) {
    return {
      chargeable: false,
      reason: "The shopper did not authorise a card-on-file charge",
    };
  }
  const cycle = order.preorderCollection;
  if (!cycle?.cycleId) {
    // A request from before advance notices existed: never charged
    // automatically until it has been adopted into a request with a notice.
    return { chargeable: false, reason: "No advance notice has been given for this balance" };
  }
  if (cycle.state !== "awaiting_payment") {
    return {
      chargeable: false,
      reason:
        cycle.state === "notice_pending"
          ? "The advance notice has not been delivered yet"
          : cycle.state === "attention"
            ? "The advance notice did not reach the shopper"
            : "The balance request is no longer open",
    };
  }
  if (!cycle.autoCharge) {
    return { chargeable: false, reason: "This request was not set up for an automatic charge" };
  }
  if (!cycle.notice?.acceptedAt) {
    return { chargeable: false, reason: "The advance notice has not been delivered yet" };
  }
  if (cycle.notice.bounced) {
    return { chargeable: false, reason: "The advance notice bounced" };
  }
  const notBefore = cycle.chargeNotBefore ? new Date(cycle.chargeNotBefore).getTime() : NaN;
  if (!Number.isFinite(notBefore) || now.getTime() < notBefore) {
    return { chargeable: false, reason: "The advance notice period has not passed" };
  }
  const mismatch = cycleMismatch(
    order,
    cycle,
    balanceDue,
    orderCurrency(order, fallbackCurrency),
  );
  if (mismatch) {
    return {
      chargeable: false,
      reason: `The balance request no longer matches the order (${mismatch.replace(/_/g, " ")})`,
    };
  }
  const scope = collectionScope(order);
  if (scope.some((sub) => sub.preorderAllocation?.state !== "committed")) {
    return { chargeable: false, reason: "The goods for this request are not allocated" };
  }
  if (order.preorderBalanceChargeOutcome === "unknown") {
    return {
      chargeable: false,
      reason: "The last attempt's outcome is still being confirmed",
    };
  }
  const code = String(order.preorderBalanceLastChargeCode || "");
  if (NEEDS_THE_SHOPPER_CODES.has(code)) {
    return {
      chargeable: false,
      reason: "The bank needs the shopper to confirm this payment",
    };
  }
  const attempts = Number(order.preorderBalanceChargeAttempts || 0);
  if (attempts >= PREORDER_BALANCE_MAX_ATTEMPTS) {
    return { chargeable: false, reason: "The retries for this card are spent" };
  }
  const lastAt = order.preorderBalanceLastChargeAt
    ? new Date(order.preorderBalanceLastChargeAt).getTime()
    : 0;
  if (lastAt && now.getTime() - lastAt < PREORDER_BALANCE_RETRY_HOURS * HOUR_MS) {
    return { chargeable: false, reason: "The retry window has not elapsed" };
  }
  return { chargeable: true, cycleId: cycle.cycleId };
}

type PreorderBalanceChargeResult =
  | { charged: true; paymentIntentId: string; amount: number; currency: string }
  | {
      charged: false;
      /**
       * `skipped`: nothing was attempted. `unknown`: an attempt was made and
       * its answer lost — it is reconciled before anything else. The rest
       * mean the card was tried and refused.
       */
      outcome: "skipped" | "needs_shopper" | "declined" | "error" | "unknown";
      reason: string;
      code?: string;
    };

function stripeErrorCode(err: unknown): string {
  const candidate = err as
    | { code?: string; decline_code?: string; type?: string }
    | null;
  return String(
    candidate?.code || candidate?.decline_code || candidate?.type || "unknown",
  );
}

function stripeErrorMessage(err: unknown): string {
  const candidate = err as { message?: string } | null;
  return String(candidate?.message || "The card was refused");
}

/**
 * Whether Stripe's answer to a charge was lost rather than given: the request
 * may have been carried out. Never read as a refusal.
 */
export function chargeOutcomeUnknown(err: unknown): boolean {
  const error = err as {
    type?: string;
    name?: string;
    code?: string;
    statusCode?: number;
    message?: string;
  } | null;
  if (!error) return false;
  if (
    error.type === "StripeConnectionError" ||
    error.type === "StripeAPIError" ||
    error.type === "StripeRateLimitError"
  ) {
    return true;
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  if (typeof error.statusCode === "number" && error.statusCode >= 500) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(String(error.code || ""));
}

/** Stable per request and attempt: a replay of THIS attempt is the same charge. */
export function offSessionChargeKey(orderId: string, cycleId: string, attempt: number) {
  return `preorder-balance-offsession:${orderId}:${cycleId}:${attempt}`;
}

/**
 * Try to collect the balance from the saved card.
 *
 * Safe from anywhere, at any frequency: the claim below is the only thing
 * that decides who charges, it re-checks the request in the database, and it
 * doubles as the retry backoff.
 */
export async function chargePreorderBalanceOffSession(params: {
  orderId: string;
  settings?: Awaited<ReturnType<typeof getSettings>>;
  now?: Date;
}): Promise<PreorderBalanceChargeResult> {
  const now = params.now || new Date();
  if (!Types.ObjectId.isValid(params.orderId)) {
    return { charged: false, outcome: "skipped", reason: "Order not found" };
  }
  const settings = params.settings || (await getSettings());
  const fallbackCurrency = String(settings.general?.defaultCurrency || "USD");

  let order = (await Order.findById(params.orderId).lean()) as ChargeableOrder | null;
  if (!order) return { charged: false, outcome: "skipped", reason: "Order not found" };

  // An attempt whose answer was lost comes first: Stripe is asked what became
  // of it, and nothing new is tried until that is known.
  if (order.preorderBalanceChargeOutcome === "unknown") {
    const reconciled = await reconcileUnknownCharge(order, settings, now);
    if (reconciled) return reconciled;
    order = (await Order.findById(params.orderId).lean()) as ChargeableOrder | null;
    if (!order) return { charged: false, outcome: "skipped", reason: "Order not found" };
  }

  const eligibility = preorderBalanceChargeEligibility(order, now, fallbackCurrency);
  if (!eligibility.chargeable) {
    return { charged: false, outcome: "skipped", reason: eligibility.reason };
  }
  const cycleId = eligibility.cycleId;

  // A product date that moved and has not reached this order yet: the goods
  // may not be coming on the date the shopper was told. Carried to it now; a
  // request it turns stale is reset there, and this charge does not happen.
  const stale = await findStaleTermsLines(order);
  if (stale.length > 0) {
    const { reconcileOrderPreorderTerms } = await import("@/lib/orders/preorder-terms-sync");
    await reconcileOrderPreorderTerms(String(order._id), { now }).catch((error) =>
      console.error("Failed to reconcile a pre-order's dates before charging:", error),
    );
    const refreshed = (await Order.findById(params.orderId).lean()) as ChargeableOrder | null;
    if (!refreshed || (await findStaleTermsLines(refreshed)).length > 0) {
      return {
        charged: false,
        outcome: "skipped",
        reason: "A release date change is still being applied to this order",
      };
    }
    order = refreshed;
    const again = preorderBalanceChargeEligibility(order, now, fallbackCurrency);
    if (!again.chargeable) return { charged: false, outcome: "skipped", reason: again.reason };
  }

  const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
  if (!isStripeSecretKeyConfigured(secretKey)) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "Card payments are not configured",
    };
  }
  const customerId = await resolveOrderStripeCustomerId(order);
  if (!customerId) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "No Stripe customer to charge the saved card against",
    };
  }
  const currency = orderCurrency(order, fallbackCurrency);
  const balanceDue = getPreorderBalanceDue(order);
  const amount = toStripeAmount(balanceDue, currency);
  if (!(amount > 0)) {
    return { charged: false, outcome: "skipped", reason: "No balance is due" };
  }

  // The claim, the backoff and the attempt's identity in one write. Every
  // condition the eligibility rule checked that the database can hold is
  // re-checked here, at the moment of charging.
  const previousAttempts = Number(order.preorderBalanceChargeAttempts || 0);
  const attempt = previousAttempts + 1;
  const chargeKey = offSessionChargeKey(String(order._id), cycleId, attempt);
  const retryCutoff = new Date(now.getTime() - PREORDER_BALANCE_RETRY_HOURS * HOUR_MS);
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
      paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIALLY_PAID] },
      "preorderCollection.cycleId": cycleId,
      "preorderCollection.state": "awaiting_payment",
      "preorderCollection.chargeNotBefore": { $lte: now },
      "preorderCollection.notice.bounced": { $ne: true },
      preorderBalanceChargeOutcome: { $ne: "unknown" },
      $and: [
        {
          $or: [
            { preorderBalancePaidAt: null },
            { preorderBalancePaidAt: { $exists: false } },
          ],
        },
        {
          $or: [
            { preorderBalanceLastChargeAt: null },
            { preorderBalanceLastChargeAt: { $exists: false } },
            { preorderBalanceLastChargeAt: { $lt: retryCutoff } },
          ],
        },
        previousAttempts > 0
          ? { preorderBalanceChargeAttempts: previousAttempts }
          : {
              $or: [
                { preorderBalanceChargeAttempts: 0 },
                { preorderBalanceChargeAttempts: null },
                { preorderBalanceChargeAttempts: { $exists: false } },
              ],
            },
      ],
    },
    {
      $set: {
        preorderBalanceLastChargeAt: now,
        preorderBalanceChargeAttempts: attempt,
        preorderBalanceChargeKey: chargeKey,
        // Unknown until Stripe answers; a crash right after this write is
        // reconciled exactly like a lost answer.
        preorderBalanceChargeOutcome: "unknown",
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "Another attempt is already in progress",
    };
  }

  const stripe = getStripeForSecretKey(secretKey);
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      offSessionIntentParams({ order, amount, currency, customerId, cycleId, attempt }),
      { idempotencyKey: chargeKey },
    );
  } catch (err) {
    if (chargeOutcomeUnknown(err)) {
      // Left `unknown`: the next run asks Stripe about this attempt by its key.
      console.error(
        `The saved-card charge for ${order.orderNumber} has an unknown outcome:`,
        stripeErrorMessage(err),
      );
      return {
        charged: false,
        outcome: "unknown",
        reason: "Stripe did not answer; the attempt will be confirmed before any other",
      };
    }
    const code = stripeErrorCode(err);
    const needsShopper = NEEDS_THE_SHOPPER_CODES.has(code);
    await recordChargeOutcome({
      orderId: order._id,
      key: chargeKey,
      outcome: needsShopper ? "needs_shopper" : err && (err as { type?: string }).type === "StripeCardError" ? "declined" : "error",
      code,
    });
    await notifyBalanceChargeFailed({
      attempt,
      order,
      amount: balanceDue,
      currency,
      needsShopper,
      settings,
    });
    return {
      charged: false,
      outcome: needsShopper ? "needs_shopper" : "declined",
      reason: stripeErrorMessage(err),
      code,
    };
  }
  return finishIntent({ order, paymentIntent, settings, chargeKey, attempt, balanceDue, currency });
}

function offSessionIntentParams(params: {
  order: ChargeableOrder;
  amount: number;
  currency: string;
  customerId: string;
  cycleId: string;
  attempt: number;
}): Stripe.PaymentIntentCreateParams {
  return {
    amount: params.amount,
    currency: params.currency.toLowerCase(),
    customer: params.customerId,
    payment_method: String(params.order.preorderSavedPaymentMethodId),
    off_session: true,
    confirm: true,
    description: `Pre-order balance for order #${params.order.orderNumber}`,
    metadata: {
      kind: PREORDER_BALANCE_CHECKOUT_KIND,
      orderId: String(params.order._id),
      orderNumber: String(params.order.orderNumber || ""),
      offSession: "true",
      preorderCycle: params.cycleId,
      preorderAttempt: String(params.attempt),
    },
  };
}

async function finishIntent(params: {
  order: ChargeableOrder;
  paymentIntent: Stripe.PaymentIntent;
  settings: Awaited<ReturnType<typeof getSettings>>;
  chargeKey: string;
  attempt: number;
  balanceDue: number;
  currency: string;
}): Promise<PreorderBalanceChargeResult> {
  const { order, paymentIntent, settings, chargeKey, attempt, balanceDue, currency } = params;
  if (paymentIntent.status !== "succeeded") {
    if (paymentIntent.status === "processing") {
      // Settled by the webhook when it lands; left `unknown` until then so no
      // second attempt is made beside it.
      return {
        charged: false,
        outcome: "unknown",
        reason: "The payment is still processing",
      };
    }
    const needsShopper = paymentIntent.status === "requires_action";
    await recordChargeOutcome({
      orderId: order._id,
      key: chargeKey,
      outcome: needsShopper ? "needs_shopper" : "declined",
      code: paymentIntent.status,
    });
    await notifyBalanceChargeFailed({
      attempt,
      order,
      amount: balanceDue,
      currency,
      needsShopper,
      settings,
    });
    return {
      charged: false,
      outcome: needsShopper ? "needs_shopper" : "declined",
      reason: `The payment ended as ${paymentIntent.status}`,
      code: paymentIntent.status,
    };
  }

  // Down the same path the shopper's own payment takes, including the release
  // for fulfilment. Idempotent against the webhook for this very intent.
  const settlement = await settlePreorderBalanceFromIntent(paymentIntent, settings);
  await recordChargeOutcome({
    orderId: order._id,
    key: chargeKey,
    outcome: settlement.settled || settlement.alreadySettled ? "succeeded" : "error",
    code: settlement.settled || settlement.alreadySettled ? undefined : settlement.reason,
  });
  if (!settlement.settled && !settlement.alreadySettled) {
    console.error(
      `Charged the saved card for ${order.orderNumber} but the balance was not recorded: ${settlement.reason || "unknown"}`,
    );
    return {
      charged: false,
      outcome: "error",
      reason: "The payment was taken but could not be applied, so it was refunded",
      code: settlement.reason,
    };
  }
  return {
    charged: true,
    paymentIntentId: paymentIntent.id,
    amount: balanceDue,
    currency,
  };
}

/**
 * Find out what happened to an attempt whose answer was lost, by asking Stripe
 * for the intent that attempt would have created. Read-only: nothing is
 * charged here.
 *
 * Returns a result when the attempt was resolved into one (settled, refused,
 * still processing, or Stripe could not be asked), or null when it never
 * reached Stripe at all and the order is free for a normal attempt.
 */
async function reconcileUnknownCharge(
  order: ChargeableOrder,
  settings: Awaited<ReturnType<typeof getSettings>>,
  now: Date,
): Promise<PreorderBalanceChargeResult | null> {
  const key = String(order.preorderBalanceChargeKey || "");
  // `preorder-balance-offsession:<order>:<cycle>:<attempt>`
  const [, keyOrderId, cycleId, attemptText] = key.split(":");
  if (keyOrderId !== String(order._id)) {
    return {
      charged: false,
      outcome: "unknown",
      reason: "The last attempt's key does not belong to this order",
    };
  }
  const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
  const customerId = await resolveOrderStripeCustomerId(order);
  if (!key || !cycleId || !isStripeSecretKeyConfigured(secretKey) || !customerId) {
    return {
      charged: false,
      outcome: "unknown",
      reason: "The last attempt cannot be confirmed with Stripe from here",
    };
  }
  const since = order.preorderBalanceLastChargeAt
    ? Math.floor(new Date(order.preorderBalanceLastChargeAt).getTime() / 1000) - 300
    : Math.floor(now.getTime() / 1000) - 7 * 24 * 3600;
  let match: Stripe.PaymentIntent | undefined;
  try {
    const stripe = getStripeForSecretKey(secretKey);
    const intents = await stripe.paymentIntents.list({
      customer: customerId,
      created: { gte: since },
      limit: 100,
    });
    match = intents.data.find(
      (intent) =>
        intent.metadata?.orderId === String(order._id) &&
        intent.metadata?.preorderCycle === cycleId &&
        intent.metadata?.preorderAttempt === attemptText,
    );
  } catch (error) {
    console.error("Failed to confirm a saved-card attempt with Stripe:", error);
    return {
      charged: false,
      outcome: "unknown",
      reason: "Stripe could not be asked about the last attempt",
    };
  }
  if (!match) {
    const startedAt = order.preorderBalanceLastChargeAt
      ? new Date(order.preorderBalanceLastChargeAt).getTime()
      : 0;
    if (startedAt && now.getTime() - startedAt < UNCONFIRMED_ATTEMPT_SETTLE_MS) {
      // Too recent to conclude anything: the request may still be on its way.
      return {
        charged: false,
        outcome: "unknown",
        reason: "The last attempt is too recent to confirm with Stripe yet",
      };
    }
    // Stripe holds no such attempt: nothing was charged. The attempt number
    // is handed back, so the next attempt is sent under the SAME idempotency
    // key — were the lost request to land after all, Stripe answers both with
    // one charge — and a charge that never happened neither counts against
    // the ceiling nor waits out the backoff.
    const attempt = Number(attemptText) || 1;
    await Order.updateOne(
      { _id: order._id, preorderBalanceChargeKey: key, preorderBalanceChargeOutcome: "unknown" },
      {
        $set: {
          preorderBalanceChargeOutcome: "error",
          preorderBalanceLastChargeCode: "not_sent",
          preorderBalanceChargeAttempts: Math.max(0, attempt - 1),
        },
        $unset: { preorderBalanceLastChargeAt: "" },
      },
    );
    return null;
  }
  return finishIntent({
    order,
    paymentIntent: match,
    settings,
    chargeKey: key,
    attempt: Number(attemptText) || 1,
    balanceDue: getPreorderBalanceDue(order),
    currency: orderCurrency(order, settings.general?.defaultCurrency),
  });
}

/**
 * The Stripe Customer the order's saved card belongs to: the order's own
 * record first (the Customer the card was ACTUALLY saved against, and a
 * guest's only one), then the shopper's account.
 */
async function resolveOrderStripeCustomerId(
  order: ChargeableOrder,
): Promise<string | undefined> {
  const onOrder = String(order.stripeCustomerId || "").trim();
  if (onOrder) return onOrder;

  const customerId = order.customerId ? String(order.customerId) : "";
  if (!customerId || !Types.ObjectId.isValid(customerId)) return undefined;
  const user = await User.findById(customerId)
    .select("stripeCustomerId")
    .lean();
  const stored = String(user?.stripeCustomerId || "").trim();
  return stored || undefined;
}

async function recordChargeOutcome(params: {
  orderId: unknown;
  key: string;
  outcome: "succeeded" | "declined" | "needs_shopper" | "error";
  code?: string;
}) {
  await Order.updateOne(
    { _id: params.orderId, preorderBalanceChargeKey: params.key },
    {
      $set: {
        preorderBalanceChargeOutcome: params.outcome,
        ...(params.code ? { preorderBalanceLastChargeCode: params.code } : {}),
      },
    },
  ).catch((err) =>
    console.error("Failed to record a pre-order balance charge outcome:", err),
  );
}

async function notifyBalanceChargeFailed(params: {
  order: ChargeableOrder;
  /** Which attempt failed — each is its own notice, not a duplicate. */
  attempt: number;
  amount: number;
  currency: string;
  needsShopper: boolean;
  settings: Awaited<ReturnType<typeof getSettings>>;
}) {
  const { order } = params;
  const { customerId, guestEmail } = order;
  if (!customerId && !guestEmail) return;
  const { notifyPreorderCustomerUpdate } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyPreorderCustomerUpdate(
    String(customerId || ""),
    String(order.orderNumber || ""),
    "payment_failed",
    String(order._id),
    {
      outstandingAmount: params.amount,
      releaseDate: order.preorderReleaseDate,
      balanceRequestedAt: order.preorderBalanceRequestedAt,
      preorderCollection: order.preorderCollection,
      chargeNeedsShopper: params.needsShopper,
      chargeAttempt: params.attempt,
      balanceCycleId: order.preorderCollection?.cycleId || undefined,
      guestEmail,
      settings: params.settings,
    },
  ).catch((err) =>
    console.error("Failed to tell a shopper their balance charge failed:", err),
  );
}

/**
 * The scheduled pass: every request whose notice window has passed, oldest
 * first, through the same charge. A skip tried nothing.
 */
export async function chargeDuePreorderBalances(
  options: { limit?: number; now?: Date } = {},
): Promise<{
  paused: boolean;
  attempted: number;
  charged: number;
  needsShopper: number;
  declined: number;
  unknown: number;
  skipped: number;
}> {
  const now = options.now || new Date();
  const summary = {
    paused: false,
    attempted: 0,
    charged: 0,
    needsShopper: 0,
    declined: 0,
    unknown: 0,
    skipped: 0,
  };
  // Rollback lever: pauses automatic collection without touching any request,
  // notice or allocation. Voluntary payment is unaffected.
  if (process.env.PREORDER_AUTO_CHARGE_PAUSED === "true") {
    return { ...summary, paused: true };
  }
  const settings = await getSettings();
  const candidates = await Order.find({
    "preorderCollection.state": "awaiting_payment",
    "preorderCollection.chargeNotBefore": { $lte: now },
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderSavedPaymentMethodId: { $nin: [null, ""] },
    preorderMandateAcceptedAt: { $ne: null },
  })
    .sort({ "preorderCollection.chargeNotBefore": 1, _id: 1 })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))
    .select("_id orderNumber")
    .lean<Array<{ _id: Types.ObjectId; orderNumber: string }>>();
  for (const order of candidates) {
    const result = await chargePreorderBalanceOffSession({
      orderId: String(order._id),
      settings,
      now,
    }).catch((err: unknown) => {
      console.error(`Failed to charge the saved card for ${order.orderNumber}:`, err);
      return { charged: false as const, outcome: "error" as const, reason: "" };
    });
    if (!result.charged && result.outcome === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    if (result.charged) summary.charged += 1;
    else if (result.outcome === "needs_shopper") summary.needsShopper += 1;
    else if (result.outcome === "declined") summary.declined += 1;
    else if (result.outcome === "unknown") summary.unknown += 1;
  }
  return summary;
}
