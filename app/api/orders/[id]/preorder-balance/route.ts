import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { createPreorderBalanceIntent } from "@/lib/payments/preorder-balance";
import { readPreorderBalanceToken } from "@/lib/payments/preorder-balance-link";
import { ValidationError } from "@/lib/api/errors";
import { z } from "zod";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
  /**
   * The signed link from the shopper's "balance due" email, for a caller with
   * no session — a guest, whose order is backed by a cart rather than a user.
   * See `lib/payments/preorder-balance-link.ts`.
   */
  accessToken: z.string().max(200).optional(),
});

/**
 * POST /api/orders/[id]/preorder-balance
 *
 * Start a card payment for the balance still owed on a deposit-mode pre-order.
 * Returns the PaymentIntent client secret the page confirms with Stripe.js;
 * the webhook (or the confirm call beside this one) records the payment once
 * it succeeds.
 *
 * Two ways in, and exactly two: the shopper is signed in and the order is
 * theirs, or they hold a link signed for this order. The second is what makes
 * a guest pre-order with a balance possible at all — their order names a cart,
 * not a user, so there is nobody for a session to match.
 *
 * `auth: "optional"` rather than public: a signed-in caller still gets their
 * own rate-limit bucket, and an anonymous one is limited by IP.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    // Moderate, not strict: this is hit on every "Pay balance" click, and a
    // strict bucket locked a shopper out for 15 minutes after five declined
    // cards with no other way to finish paying for their order.
    rateLimit: { action: "orders:preorder-balance:intent", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { locale, accessToken } = await validateBody(request, BodySchema);

    // The token carries the order it was signed for, so a link for one order
    // cannot open another: it has to name THIS one.
    const viaAccessLink = readPreorderBalanceToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) {
      throw new ValidationError("Order not found");
    }

    const intent = await createPreorderBalanceIntent({
      orderId: params.id,
      customerId: viaAccessLink ? undefined : session?.user?.id,
      viaAccessLink,
      customerEmail: session?.user?.email || undefined,
      locale,
    });
    return successResponse(intent);
  },
);
