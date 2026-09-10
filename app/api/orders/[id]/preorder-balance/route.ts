import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { createPreorderBalanceIntent } from "@/lib/payments/preorder-balance";
import { z } from "zod";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
});

/**
 * POST /api/orders/[id]/preorder-balance
 *
 * Start a card payment for the balance still owed on the caller's own
 * deposit-mode pre-order. Returns the PaymentIntent client secret the order
 * page confirms with Stripe.js; the webhook (or the confirm call below)
 * records the payment once it succeeds.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    // Moderate, not strict: this is hit on every "Pay balance" click, and a
    // strict bucket locked a shopper out for 15 minutes after five declined
    // cards with no other way to finish paying for their order.
    rateLimit: { action: "orders:preorder-balance:intent", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { locale } = await validateBody(request, BodySchema);
    const intent = await createPreorderBalanceIntent({
      orderId: params.id,
      customerId: session.user.id,
      customerEmail: session.user.email || undefined,
      locale,
    });
    return successResponse(intent);
  },
);
