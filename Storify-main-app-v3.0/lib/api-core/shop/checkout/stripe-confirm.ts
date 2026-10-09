import type Stripe from "stripe";
import {
  CHECKOUT_REASONS,
  StripeConfirmRequest,
  StripeConfirmation,
} from "@/contracts/mobile/shop/v1/checkout";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { withRequestScope } from "@/lib/api/request-scope";
import { getStripeForSecretKey, isStripeSecretKeyConfigured } from "@/lib/payments/stripe";
import { verifyStripePaymentIntent, type StripeVerification } from "@/lib/payments/stripe-verify";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { Cart } from "@/models";
import { getSettings } from "@/models/settings.model";

function intentNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "There is no such payment.");
}

/**
 * Whether the payment is this caller's: the shopper it was started for (the
 * intent's `userId`), or the cart it was started from — the guest's
 * `X-Cart-Token`, which still names that cart after its order emptied it.
 * Anything else is answered as if the payment did not exist.
 */
async function ownerCheck(session: MobileSession | null, client: ClientInfo) {
  const cart = client.cartToken
    ? await Cart.findOne({ sessionId: client.cartToken }).select("_id").lean<{ _id: unknown } | null>()
    : null;
  const cartId = cart ? String(cart._id) : null;
  return (intent: Stripe.PaymentIntent) => {
    const metadata = intent.metadata ?? {};
    const forUser = Boolean(session && metadata.userId === session.user.id);
    const forCart = Boolean(cartId && metadata.cartId === cartId);
    if (!forUser && !forCart) throw intentNotFound();
  };
}

/** Stripe's answer and the order, as the app reacts to them. */
function confirmationOf(verified: StripeVerification, currency: string): StripeConfirmation {
  const base = { paymentStatus: verified.status };
  const { order, returned } = verified;
  if (order) {
    const ids = { orderId: order.orderId, orderNumber: order.orderNumber };
    const { outcome } = order;
    if (outcome.outcome === "order_placed") {
      return {
        ...base,
        outcome: "ORDER_PLACED",
        ...ids,
        ...(outcome.refundedAmount ? { refunded: toMoney(outcome.refundedAmount, currency) } : {}),
      };
    }
    if (outcome.outcome === "order_cancelled") {
      return {
        ...base,
        outcome: "ORDER_CANCELLED",
        ...ids,
        ...(outcome.refunded && outcome.refundedAmount
          ? { refunded: toMoney(outcome.refundedAmount, currency) }
          : {}),
      };
    }
    return { ...base, outcome: "PAYMENT_RETURNED", ...ids };
  }
  if (returned) return { ...base, outcome: "PAYMENT_RETURNED" };
  // Stripe has not finished, or has the money and the order is still being
  // written: ask again. A card that was not charged is the sheet's to explain.
  if (verified.status === "requires_payment_method" || verified.status === "canceled") {
    return { ...base, outcome: "NOT_PAID" };
  }
  return { ...base, outcome: "PENDING" };
}

/**
 * POST /checkout/stripe/confirm, after PaymentSheet closes with success: what
 * the payment came to. Stripe's webhook writes the order; when it has not
 * yet, and Stripe says the money is in, the order is written here — the same
 * idempotent finalizer the website's success page uses
 * (lib/payments/stripe-verify.ts). Only the shopper or the cart the payment
 * was started for may ask.
 */
export const stripeConfirmRoute = defineRoute({
  id: "checkout.stripe.confirm",
  method: "POST",
  path: "/checkout/stripe/confirm",
  auth: "optional",
  cache: { kind: "private" },
  // The website's success page polls the same lookup on this preset.
  rateLimit: { bucket: "payments:verify", preset: "lenient" },
  demo: "default",
  input: StripeConfirmRequest,
  output: StripeConfirmation,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client }) =>
    withRequestScope(async () => {
      const settings = await getSettings();
      const { secretKey } = resolveStripeCredentials(settings.payment?.stripe);
      if (!settings.payment?.stripe?.enabled || !isStripeSecretKeyConfigured(secretKey)) {
        throw new MobileApiError(409, "CONFLICT", "Card payments are not available.", {
          reason: "PAYMENT_METHOD_UNAVAILABLE",
        });
      }
      const assertOwner = await ownerCheck(session, client);
      let verified: StripeVerification | null;
      try {
        verified = await verifyStripePaymentIntent(
          getStripeForSecretKey(secretKey),
          input.paymentIntentId,
          settings,
          { assertOwner },
        );
      } catch (error) {
        // Stripe has no intent by that id.
        if ((error as { statusCode?: number })?.statusCode === 404) throw intentNotFound();
        throw error;
      }
      if (!verified) throw intentNotFound();
      return confirmationOf(verified, settings.general?.defaultCurrency || "USD");
    }),
});
