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
  PREORDER_BALANCE_CHECKOUT_KIND,
  settlePreorderBalanceFromIntent,
} from "@/lib/payments/preorder-balance";

/**
 * Taking the pre-order balance off the card the shopper left with us.
 *
 * This is the half the whole card-on-file chain was built for. The Customer
 * exists (`stripe-customer.ts`), the card is saved against it and the shopper
 * authorised the charge (`preorder-mandate.ts`); this is where that permission
 * is finally used, so that a shopper who agreed to it never has to come back
 * and type a card again for money they already said we could take.
 *
 * **It is an attempt, never a guarantee.** An off-session charge fails in ways
 * an on-session one does not — the card expired during a six-month lead time,
 * the bank wants the shopper present for 3-D Secure, the funds are not there.
 * So every failure path here ends in the same two places: the shopper is told
 * what happened and pointed at the page where they can pay it themselves, and
 * the reason is written down. The manual page is not a fallback bolted on, it
 * is the other half of the design.
 *
 * Nothing here decides to give up on an order. When the retries are spent the
 * balance simply stays owed, and the expiry sweep cancels and refunds it at
 * the store's grace deadline exactly as it does for a shopper who never paid —
 * one rule for an unpaid balance, whoever was supposed to collect it.
 */

/** How long a failed attempt waits before the sweep may try again. */
export const PREORDER_BALANCE_RETRY_HOURS = 24;

/**
 * How many times in all, counting the first.
 *
 * Three over three days sits comfortably inside even the shortest grace period
 * a store is likely to set, so the retries are always finished — and the
 * shopper always warned — before anything is cancelled.
 */
export const PREORDER_BALANCE_MAX_ATTEMPTS = 3;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Stripe codes that no amount of retrying will get past, because they are not
 * about the card at all: they are the bank asking for the shopper.
 *
 * Retrying one off-session produces the identical refusal, so a sweep that did
 * would burn its attempts on a certainty and leave nothing for a card that
 * might genuinely have recovered.
 */
const NEEDS_THE_SHOPPER_CODES: ReadonlySet<string> = new Set([
  "authentication_required",
]);

export type ChargeableOrder = {
  _id?: unknown;
  orderNumber?: string;
  currency?: string;
  customerId?: unknown;
  guestEmail?: string;
  preorderReleaseDate?: Date;
  preorderBalanceRequestedAt?: Date;
  status?: string;
  paymentStatus?: string;
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
  subOrders?: Array<{
    status?: string;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

export type ChargeEligibility =
  | { chargeable: true }
  | { chargeable: false; reason: string };

/**
 * Whether this order may be charged off-session right now.
 *
 * Pure, and the only place the rule lives: the sweep uses it to decide, the
 * charge uses it to refuse, and the tests read it directly. The database query
 * that finds candidates only narrows — it never decides.
 */
export function preorderBalanceChargeEligibility(
  order: ChargeableOrder,
  now: Date = new Date(),
): ChargeEligibility {
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) {
    return { chargeable: false, reason: "The order was cancelled" };
  }
  // Only once the store has actually asked. A reservation still waiting on
  // stock has a balance on paper, and charging it would be taking money for
  // goods nobody has yet.
  if (order.preorderStatus !== PREORDER_ITEM_STATUS.PAYMENT_DUE) {
    return { chargeable: false, reason: "The balance has not been asked for" };
  }
  if (getPreorderBalanceDue(order) <= 0) {
    return { chargeable: false, reason: "No balance is due" };
  }
  if (!order.preorderSavedPaymentMethodId) {
    return { chargeable: false, reason: "No card was saved for this order" };
  }
  // The card may be on file from a checkout that predates the mandate, or
  // from one where the shopper declined it. Either way there is no permission.
  if (!order.preorderMandateAcceptedAt) {
    return {
      chargeable: false,
      reason: "The shopper did not authorise a card-on-file charge",
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
  return { chargeable: true };
}

export type PreorderBalanceChargeResult =
  | { charged: true; paymentIntentId: string; amount: number; currency: string }
  | {
      charged: false;
      /**
       * `skipped` means nothing was attempted — ineligible, or another caller
       * held the claim. The rest mean a charge was made and refused.
       */
      outcome: "skipped" | "needs_shopper" | "declined" | "error";
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
 * Try to collect the balance from the saved card.
 *
 * Safe to call from anywhere and at any frequency: the claim below is what
 * decides who charges, and it doubles as the retry backoff, so a sweep that
 * overlaps itself — or a store action that lands in the same second as a
 * sweep — cannot produce two charges.
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

  const order = (await Order.findById(
    params.orderId,
  ).lean()) as ChargeableOrder | null;
  if (!order) {
    return { charged: false, outcome: "skipped", reason: "Order not found" };
  }

  const eligibility = preorderBalanceChargeEligibility(order, now);
  if (!eligibility.chargeable) {
    return { charged: false, outcome: "skipped", reason: eligibility.reason };
  }

  const settings = params.settings || (await getSettings());
  const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
  if (!isStripeSecretKeyConfigured(secretKey)) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "Card payments are not configured",
    };
  }

  // The card is attached to the shopper's Customer, and Stripe will only
  // charge it off-session when both are named. An order whose shopper has no
  // Customer cannot have a saved card in the first place, so this is a
  // consistency check rather than an expected branch.
  const customerId = await resolveOrderStripeCustomerId(order);
  if (!customerId) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "No Stripe customer to charge the saved card against",
    };
  }

  const currency = String(
    order.currency || settings.general?.defaultCurrency || "USD",
  )
    .trim()
    .toUpperCase();
  const balanceDue = getPreorderBalanceDue(order);
  const amount = toStripeAmount(balanceDue, currency);
  if (!(amount > 0)) {
    return { charged: false, outcome: "skipped", reason: "No balance is due" };
  }

  // The claim, and the backoff, in one write: only the caller that moves the
  // stamp charges, and it can only be moved once the window has elapsed. A
  // loser is not an error — it means somebody else is already doing this.
  const retryCutoff = new Date(
    now.getTime() - PREORDER_BALANCE_RETRY_HOURS * HOUR_MS,
  );
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
      // Re-read under the claim, not just in the eligibility check above: the
      // shopper can pay from their own order page at any moment, and the
      // window between deciding and charging is exactly where they would.
      // The settle path would refund a charge it cannot record, so the money
      // would come back — but not before their statement showed it going out.
      paymentStatus: {
        $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIALLY_PAID],
      },
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
      ],
    },
    {
      $set: { preorderBalanceLastChargeAt: now },
      $inc: { preorderBalanceChargeAttempts: 1 },
    },
    { returnDocument: "after" },
  ).lean<{ preorderBalanceChargeAttempts?: number } | null>();
  if (!claimed) {
    return {
      charged: false,
      outcome: "skipped",
      reason: "Another attempt is already in progress",
    };
  }
  const attempt = Number(claimed.preorderBalanceChargeAttempts || 1);

  const stripe = getStripeForSecretKey(secretKey);
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        customer: customerId,
        payment_method: String(order.preorderSavedPaymentMethodId),
        // The two together are what make this a charge against a stored
        // mandate rather than a payment nobody is there to complete.
        off_session: true,
        confirm: true,
        description: `Pre-order balance for order #${order.orderNumber}`,
        metadata: {
          // The same tag the shopper's own payment carries, so the webhook
          // settles this one down the identical path — there is no second
          // kind of balance payment, only a second way of starting one.
          kind: PREORDER_BALANCE_CHECKOUT_KIND,
          orderId: String(order._id),
          orderNumber: String(order.orderNumber || ""),
          offSession: "true",
        },
      },
      {
        // The attempt number is in the key so a retry a day later is a new
        // request, while a replay of THIS attempt — a timeout, a crashed
        // sweep — returns the charge that was already made instead of making
        // a second one.
        idempotencyKey: `preorder-balance-offsession:${String(order._id)}:${amount}:${currency}:${attempt}`,
      },
    );
  } catch (err) {
    const code = stripeErrorCode(err);
    const message = stripeErrorMessage(err);
    const needsShopper = NEEDS_THE_SHOPPER_CODES.has(code);
    // The code itself is what stops the retries when the bank wants the
    // shopper — no attempt is handed back, because handing one back would buy
    // a retry that `preorderBalanceChargeEligibility` refuses anyway.
    await recordChargeFailure({ orderId: order._id, code });
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
      reason: message,
      code,
    };
  }

  if (paymentIntent.status !== "succeeded") {
    // `processing` belongs to slower methods than the cards this path uses,
    // but it is not an error: the webhook settles it when it lands. Anything
    // else is a refusal that did not throw.
    if (paymentIntent.status === "processing") {
      return {
        charged: false,
        outcome: "skipped",
        reason: "The payment is still processing",
      };
    }
    await recordChargeFailure({ orderId: order._id, code: paymentIntent.status });
    await notifyBalanceChargeFailed({
      attempt,
      order,
      amount: balanceDue,
      currency,
      needsShopper: paymentIntent.status === "requires_action",
      settings,
    });
    return {
      charged: false,
      outcome: "declined",
      reason: `The payment ended as ${paymentIntent.status}`,
      code: paymentIntent.status,
    };
  }

  // Down the same path the shopper's own payment takes, including the release
  // for fulfilment and the "ready" message. Idempotent against the webhook,
  // which is about to be told about this very intent.
  const settlement = await settlePreorderBalanceFromIntent(
    paymentIntent,
    settings,
  );

  // A capture is not a collection. The settle path refunds any balance it
  // cannot record — the order was cancelled underneath us, an admin wrote the
  // balance off first — and reporting that as collected would have the caller
  // skip the "please pay" message for money that has already gone back.
  // `alreadySettled` is the happy loser: somebody else recorded this exact
  // intent, so the balance really is in.
  if (!settlement.settled && !settlement.alreadySettled) {
    console.error(
      `Charged the saved card for ${order.orderNumber} but the balance was not recorded: ${settlement.reason || "unknown"}`,
    );
    return {
      charged: false,
      outcome: "error",
      reason:
        "The payment was taken but could not be applied, so it was refunded",
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
 * The store has just asked for the balance — take it if we can.
 *
 * What the two "mark ready" routes call, so that a shopper who left a card and
 * authorised it is never asked for money the store can simply collect. It
 * answers the only two things the caller needs to know: whether the money
 * arrived, and whether the shopper has already been written to — because both
 * a success and a failure send their own message, and the routes' own
 * "please pay the balance" ask would be a second one saying something else.
 */
export async function collectPreorderBalanceOnRequest(orderId: string): Promise<{
  collected: boolean;
  shopperAlreadyTold: boolean;
}> {
  try {
    const result = await chargePreorderBalanceOffSession({ orderId });
    if (result.charged) {
      // The settle path releases the order and sends its own "ready".
      return { collected: true, shopperAlreadyTold: true };
    }
    // Only the two refusal paths write to the shopper. A skip tried nothing,
    // and an `error` is a capture that was refunded without a word — both
    // leave the caller's own "please pay the balance" ask to do the telling.
    return {
      collected: false,
      shopperAlreadyTold:
        result.outcome === "declined" || result.outcome === "needs_shopper",
    };
  } catch (err) {
    // Nothing is known about whether the shopper heard anything, so assume
    // they did not: a duplicate ask is a nuisance, silence is a lost sale.
    console.error(
      "Failed to charge a saved card when the balance was requested:",
      err,
    );
    return { collected: false, shopperAlreadyTold: false };
  }
}

/**
 * The Stripe Customer the order's saved card belongs to.
 *
 * The order's own record comes first, because it names the Customer the card
 * was ACTUALLY saved against — and for a guest it is the only record there is:
 * their Customer was minted for the cart and never lived on any account.
 * Orders that predate that record fall back to the shopper's account, which is
 * where a signed-in shopper's Customer has always been kept.
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

async function recordChargeFailure(params: {
  orderId: unknown;
  code: string;
}) {
  await Order.updateOne(
    { _id: params.orderId },
    { $set: { preorderBalanceLastChargeCode: params.code } },
  ).catch((err) =>
    console.error("Failed to record a pre-order balance charge failure:", err),
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
      chargeNeedsShopper: params.needsShopper,
      chargeAttempt: params.attempt,
      guestEmail,
      settings: params.settings,
    },
  ).catch((err) =>
    console.error("Failed to tell a shopper their balance charge failed:", err),
  );
}
