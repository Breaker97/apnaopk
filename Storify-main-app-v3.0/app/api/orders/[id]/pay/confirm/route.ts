import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
import { readOrderPayToken } from "@/lib/payments/preorder-balance-link";
import {
  ORDER_PAY_CHECKOUT_KIND,
  settleOrderPayIntent,
} from "@/lib/payments/order-pay";
import * as z from "zod";

const BodySchema = z.object({
  paymentIntentId: z.string().min(1).max(255),
  /** The same signed link the intent was started with — see that route. */
  accessToken: z.string().max(300).optional(),
});

/**
 * POST /api/orders/[id]/pay/confirm
 *
 * Called the moment Stripe.js confirms the card, so the shopper sees their
 * order paid without waiting for the webhook. Idempotent against it: whichever
 * lands first records the payment and the other is told it was already paid.
 *
 * Nothing the client sent is trusted beyond the intent id. The intent is read
 * back from Stripe, must carry this order's id in metadata that only this
 * server writes, and the settle step re-checks the amount and currency.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:pay:confirm", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const { paymentIntentId, accessToken } = await validateBody(
      request,
      BodySchema,
    );

    const viaAccessLink = readOrderPayToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) return notFoundResponse("Order");

    const order = await Order.findOne(
      viaAccessLink
        ? { _id: params.id }
        : { _id: params.id, customerId: session?.user?.id },
    )
      .select("_id")
      .lean();
    if (!order) return notFoundResponse("Order");

    const settings = await getSettings();
    const secretKey = resolveStripeCredentials(
      settings.payment?.stripe,
    ).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) {
      throw new ValidationError("Card payments are not configured");
    }
    const paymentIntent = await getStripeForSecretKey(
      secretKey,
    ).paymentIntents.retrieve(paymentIntentId);

    // The intent has to say, in metadata this server wrote, that it is a pay
    // link for THIS order. Without that check a caller could hand over any
    // intent id they had ever been given and have it recorded here.
    const metadata = paymentIntent.metadata || {};
    if (
      metadata.kind !== ORDER_PAY_CHECKOUT_KIND ||
      String(metadata.orderId || "") !== params.id
    ) {
      throw new ValidationError("This payment does not belong to this order");
    }

    const result = await settleOrderPayIntent(paymentIntent, settings);

    const after = await Order.findById(params.id)
      .select("status paymentStatus paymentMethod total")
      .lean();

    return successResponse({
      settled: result.settled,
      alreadyPaid: result.settled ? Boolean(result.alreadyPaid) : false,
      // Not refused, not recorded: the bank is still confirming and the
      // webhook records it when it clears. Reported apart, because "not
      // settled" alone reads as a payment that failed.
      pending:
        !result.settled && "reason" in result && result.reason === "not_succeeded",
      intentStatus: paymentIntent.status,
      paymentStatus: after?.paymentStatus,
      status: after?.status,
    });
  },
);
