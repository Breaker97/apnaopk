import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { getStripeForSecretKey, isStripeSecretKeyConfigured } from "@/lib/payments/stripe";
import { settlePreorderBalanceFromIntent } from "@/lib/payments/preorder-balance";
import { readPreorderBalanceToken } from "@/lib/payments/preorder-balance-link";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { z } from "zod";

const BodySchema = z.object({
  paymentIntentId: z.string().min(1).max(255),
  /** The same signed link the intent was started with — see that route. */
  accessToken: z.string().max(200).optional(),
});

/**
 * POST /api/orders/[id]/preorder-balance/confirm
 *
 * The order page calls this right after Stripe.js confirms the balance
 * intent, so the shopper sees "paid" without waiting for the webhook. It
 * trusts nothing the client sent beyond the intent id: the intent is read
 * back from Stripe, must be the one stamped on THIS order, and the settle
 * step re-checks the amount. Idempotent against the webhook.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:preorder-balance:confirm", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const { paymentIntentId, accessToken } = await validateBody(
      request,
      BodySchema,
    );

    // Same two ways in as the route that started the intent, and the same
    // reason — a guest's order is backed by a cart, so only the signed link
    // can speak for them. The intent is still read back from Stripe below and
    // still has to be the one stamped on THIS order, so the link buys entry,
    // not trust.
    const viaAccessLink = readPreorderBalanceToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) return notFoundResponse("Order");

    const order = await Order.findOne(
      viaAccessLink
        ? { _id: params.id }
        : { _id: params.id, customerId: session?.user?.id },
    )
      .select(
        "orderNumber status paymentStatus preorderOutstandingAmount preorderBalancePaymentIntentId preorderBalancePaidAt",
      )
      .lean();
    if (!order) return notFoundResponse("Order");
    if (order.preorderBalancePaymentIntentId !== paymentIntentId) {
      throw new ValidationError("This payment does not belong to this order");
    }

    const settings = await getSettings();
    const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) {
      throw new ValidationError("Card payments are not configured");
    }
    const paymentIntent = await getStripeForSecretKey(secretKey).paymentIntents.retrieve(
      paymentIntentId,
    );

    const result = await settlePreorderBalanceFromIntent(paymentIntent, settings);

    const after = await Order.findById(order._id)
      .select(
        // `subOrders` is not decoration: `getPreorderBalanceDue` nets off any
        // consignment a vendor has cancelled, and without them it would
        // report the shopper still owing for goods nobody is sending.
        "status paymentStatus paymentMethod preorderStatus preorderOutstandingAmount total subOrders.status subOrders.items.preorderOutstandingAmount",
      )
      .lean();
    // `alreadySettled` is the racing webhook having recorded the same intent,
    // which is a success. Every other unsettled outcome refunded the capture
    // and raised an admin anomaly, so the shopper is told plainly rather than
    // being shown a paid order that is not paid.
    return successResponse({
      settled: result.settled || Boolean(result.alreadySettled),
      reason: result.reason,
      intentStatus: paymentIntent.status,
      paymentStatus: after?.paymentStatus,
      preorderStatus: after?.preorderStatus,
      balanceDue: after ? getPreorderBalanceDue(after) : 0,
    });
  },
);
