/**
 * Stripe webhook processors for platform payments (product boosts). Follow
 * the vendor-billing convention: each returns `handled: boolean` so the
 * shared webhook chains them ahead of the order finalizer and falls through
 * when the session belongs to someone else.
 */

import type Stripe from "stripe";
import type { Types } from "mongoose";
import { BoostCampaign, PlatformPayment, Product } from "@/models";
import {
  NON_TERMINAL_BOOST_CAMPAIGN_STATUSES,
  type IBoostCampaign,
} from "@/models/boostCampaign.model";
import {
  refundedBelowMatch,
  type IPlatformPayment,
} from "@/models/platformPayment.model";
import { addDays } from "@/lib/boosts/boost-days";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { currencyPriceScale } from "@/lib/intl/money";
import { sendBoostNotification } from "@/lib/boosts/boost-notifications";
import { isBoostCheckoutSession } from "@/lib/boosts/boost-checkout-binding";
import {
  finalizePlatformPayment,
  markPlatformPaymentReversed,
} from "@/lib/payments/platform-payments";
import {
  cancelBoostCampaign,
  consumedDays,
  refreshBoostCredit,
  truncateBoostCampaign,
} from "@/lib/boosts/boosts";
import {
  BOOST_CANCEL_REASON,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";

async function findPaymentForSession(session: Stripe.Checkout.Session) {
  const byId = await PlatformPayment.findOne({
    stripeCheckoutSessionId: session.id,
  });
  if (byId) return byId;
  // The session-id patch races the webhook (two-phase write); metadata is
  // stamped at session creation and cannot race.
  const paymentId = session.metadata?.paymentId;
  return paymentId ? PlatformPayment.findById(paymentId) : null;
}

/** `checkout.session.completed` — activate the boost once Stripe confirms. */
export async function processPlatformCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (!isBoostCheckoutSession(session)) return false;
  const payment = await findPaymentForSession(session);
  if (!payment) {
    console.error(
      `Boost checkout session ${session.id} completed but no PlatformPayment matches`,
    );
    return true;
  }
  if (session.payment_status !== "paid") return true;
  await finalizePlatformPayment(payment, {
    // Stripe was told the amount at session creation with toStripeAmount;
    // completion of THIS session is confirmation of THAT amount.
    patch: {
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as Stripe.PaymentIntent | null)?.id ??
            undefined,
    },
  });
  return true;
}

/** `checkout.session.expired` — release the product slot for a new attempt. */
export async function processPlatformCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (!isBoostCheckoutSession(session)) return false;
  const payment = await findPaymentForSession(session);
  if (!payment) return true;

  await PlatformPayment.updateOne(
    { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
    { $set: { status: PLATFORM_PAYMENT_STATUS.EXPIRED } },
  );
  if (payment.kind === PLATFORM_PAYMENT_KIND.BOOST && payment.campaignId) {
    // Only if nothing has paid for the campaign yet. A vendor who abandons one
    // checkout and pays with another leaves the first session to expire 24h
    // later; without this guard that stale event would cancel the live boost
    // they already paid for.
    await cancelBoostCampaign(
      String(payment.campaignId),
      BOOST_CANCEL_REASON.CHECKOUT_EXPIRED,
      { onlyIfUnpaid: true },
    );
  }
  return true;
}

/**
 * `charge.refunded` on a platform payment intent — tear the benefit down.
 *
 * Stripe emits this event for PARTIAL refunds too, so the charge's own totals
 * decide: only a full refund reverses the attempt. Without that check a small
 * goodwill refund would cancel the vendor's entire remaining boost, which
 * `cancelBoostCampaign` cannot undo.
 */
export async function processPlatformChargeRefunded(
  charge: Stripe.Charge,
): Promise<boolean> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  if (!paymentIntentId) return false;
  const payment = await PlatformPayment.findOne({
    stripePaymentIntentId: paymentIntentId,
  });
  if (!payment) return false;

  const fullyRefunded =
    charge.refunded === true ||
    (typeof charge.amount_refunded === "number" &&
      typeof charge.amount === "number" &&
      charge.amount_refunded >= charge.amount);
  if (!fullyRefunded) {
    // A flat fee had no per-unit basis, so this used to bail out. pricePerDay
    // supplies one: map the refund onto released days.
    // In the unit the charge was made in: `toStripeAmount` builds a 3-decimal
    // currency in thousandths, and dividing it back by 100 booked a 1.000 KWD
    // refund as 10 — releasing ten times the days that were paid back.
    await applyBoostPartialRefund(
      payment,
      fromStripeAmount(charge.amount_refunded ?? 0, payment.currency || "USD"),
    );
    return true;
  }

  await markPlatformPaymentReversed(payment);
  return true;
}

/**
 * A platform payment refunded from PayPal, Razorpay or Paystack's own
 * dashboard, given what that gateway says has been refunded on it IN TOTAL.
 *
 * Only Stripe's `charge.refunded` was ever wired to platform payments: a boost
 * bought through any other gateway and refunded there kept running, and its
 * income stayed on the books. Driven by the running total exactly as the
 * Stripe path is, so a replayed or out-of-order delivery recomputes the same
 * answer rather than counting a refund twice.
 */
export async function applyPlatformPaymentRefundTotal(params: {
  locate: {
    paypalCaptureId?: string;
    razorpayPaymentId?: string;
    paystackTransactionId?: string;
    reference?: string;
  };
  refundedTotalMajor: number;
}): Promise<boolean> {
  const clauses = Object.entries(params.locate)
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([field, value]) => ({ [field]: value }));
  if (clauses.length === 0) return false;
  const payment = await PlatformPayment.findOne({ $or: clauses });
  if (!payment) return false;

  const refunded = Math.max(0, Number(params.refundedTotalMajor) || 0);
  if (refunded <= 0) return false;
  if (refunded >= Number(payment.amount || 0) - 0.005) {
    await markPlatformPaymentReversed(payment);
    return true;
  }
  await applyBoostPartialRefund(payment, refunded);
  return true;
}

/**
 * Map a CUMULATIVE refund total onto released days.
 *
 * The release is a function of the running total, never of one webhook's delta.
 * Stripe's amount_refunded is cumulative and arrives replayed, out of order and
 * concurrently. A delta form discards every sub-day remainder — three small
 * goodwill refunds would release nothing while the cash left — and lets two
 * concurrent claims delete the same trailing days while both increment the
 * counter.
 *
 * `billedDays` is immutable and `refundedDays` is monotonic, so the booking is
 * derivable: endDay = startDay + (billedDays - refundedDays) - 1. A replay
 * recomputes the same end day and changes nothing.
 *
 * Trailing days are released, never leading ones: the vendor keeps what ran.
 */
async function applyBoostPartialRefund(
  payment: IPlatformPayment,
  refundedTotalMajor: number,
): Promise<void> {
  const campaign = await BoostCampaign.findOne({
    _id: payment.campaignId,
    paymentId: payment._id,
    status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
  });
  if (!campaign) return;

  // The SAME scale the charge used: currencyPriceScale, never
  // currencyMinorUnitExponent. A 3-decimal currency is charged in multiples of
  // ten minor units; refunding on the finer grid disagrees with the charge by a
  // rounding cent that compounds over successive partials.
  const factor = 10 ** currencyPriceScale(campaign.currency);
  const perDayMinor = Math.round(
    campaign.positionSnapshot.pricePerDay * factor,
  );
  if (perDayMinor <= 0) return;
  const refundedMinor = Math.round(refundedTotalMajor * factor);

  const targetRefundedDays = Math.min(
    Math.floor(refundedMinor / perDayMinor),
    campaign.billedDays,
  );

  // Record the cash unconditionally — it is the ledger even when it buys no
  // whole day, and the credit formula subtracts it from what is owed.
  //
  // Claimed with `returnDocument: "before"` because the STEP is what the books
  // take, not the running total: Stripe's figure is cumulative, so posting it
  // whole on the second webhook would give back the first refund twice. Losing
  // the claim — a replay, a stale total, the loser of two concurrent webhooks
  // — means some other call already booked this ground, and there is nothing
  // to post.
  const claimedRefund = await PlatformPayment.findOneAndUpdate(
    { _id: payment._id, ...refundedBelowMatch(refundedTotalMajor) },
    { $set: { refundedAmount: refundedTotalMajor } },
    { returnDocument: "before" },
  )
    .select("refundedAmount")
    .lean<{ refundedAmount?: number } | null>();

  if (claimedRefund) {
    const { postPlatformPaymentRefundSafely } = await import(
      "@/lib/finance/post-events"
    );
    postPlatformPaymentRefundSafely({
      _id: payment._id,
      kind: payment.kind,
      reference: payment.reference,
      vendorId: payment.vendorId,
      currency: payment.currency,
      provider: payment.provider,
      refundedTotal: refundedTotalMajor,
      previouslyRefunded: claimedRefund.refundedAmount ?? 0,
      refundedAt: new Date(),
    });
  }

  // Claim the INCREASE atomically. A replay, a lower cumulative total arriving
  // late, and the loser of two concurrent webhooks all fail this CAS. The
  // pipeline moves releasedDays by the same increment in the same write, so the
  // two counters can never disagree.
  const claimed = await BoostCampaign.findOneAndUpdate(
    {
      _id: campaign._id,
      status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
      refundedDays: { $lt: targetRefundedDays },
    },
    [
      {
        $set: {
          releasedDays: {
            $add: [
              "$releasedDays",
              { $subtract: [targetRefundedDays, "$refundedDays"] },
            ],
          },
          refundedDays: targetRefundedDays,
        },
      },
    ],
    { returnDocument: "before" },
  );
  if (!claimed) {
    await refreshBoostCredit(campaign._id as Types.ObjectId);
    return;
  }

  const remainingBilled = campaign.billedDays - targetRefundedDays;
  const served = consumedDays(campaign);

  // The refund has bought the whole remaining range: that is a cancellation,
  // not a truncation. Truncating would derive an end day at or before the
  // start, and updateOne runs without validators so the schema min would never
  // fire.
  if (remainingBilled <= 0 || remainingBilled < served) {
    await cancelBoostCampaign(
      String(campaign._id),
      BOOST_CANCEL_REASON.PAYMENT_REVERSED,
    );
    return;
  }

  const newEndDay = addDays(campaign.startDay, remainingBilled - 1);
  const released = await truncateBoostCampaign(
    campaign._id as Types.ObjectId,
    newEndDay,
  );
  await refreshBoostCredit(campaign._id as Types.ObjectId);
  if (released.length > 0) {
    await sendBoostDaysReleasedNotice(campaign, released);
  }
}

/** Fire-and-forget: the vendor is told which days went and that they are credited. */
async function sendBoostDaysReleasedNotice(
  campaign: IBoostCampaign,
  days: string[],
) {
  try {
    const product = await Product.findById(campaign.productId)
      .select("name")
      .lean<{ name?: string } | null>();
    await sendBoostNotification("days_released", campaign, product?.name || "", {
      days,
    });
  } catch (error) {
    console.error("Failed to send boost days-released notification:", error);
  }
}
