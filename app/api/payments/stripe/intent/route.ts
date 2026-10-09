import { withRequestScope } from "@/lib/api/request-scope";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  getClientIP,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { assertShopperSession } from "@/lib/checkout/shopper-account";
import {
  CardIntentFailure,
  CreateStripeIntentBodySchema,
  createStripeCardIntent,
} from "@/lib/checkout/stripe-card-intent";

/**
 * POST /api/payments/stripe/intent
 * Create Stripe PaymentIntent for inline card payment
 *
 * The pricing and the intent are lib/checkout/stripe-card-intent.ts; this is
 * the browser's door to it: the session, the cart cookie, the rate limit and
 * the body.
 */
// One read of the store's settings for the whole request — see
// lib/api/request-scope.ts. This route never writes them.
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => withRequestScope(async () => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;


    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:stripe-intent",
        "strict",
        session.user.role
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:stripe-intent",
        "strict",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "strict");
    }
    // The same buyers the checkout route refuses — see
    // lib/checkout/shopper-account.ts — before any cart or PaymentIntent.
    assertShopperSession(session);

    await connectDB();

    const body = await validateBody(request, CreateStripeIntentBodySchema);
    try {
      const intent = await createStripeCardIntent(body, {
        user: session?.user
          ? {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
              phone: (session.user as { phone?: string | null }).phone,
            }
          : null,
        cartSessionId,
        clientIp: getClientIP(request),
        userAgent: request.headers.get("user-agent"),
      });
      return NextResponse.json({
        success: true,
        data:
          intent.mode === "setup"
            ? {
                mode: "setup",
                setupIntentId: intent.setupIntentId,
                clientSecret: intent.clientSecret,
              }
            : {
                mode: "payment",
                paymentIntentId: intent.paymentIntentId,
                clientSecret: intent.clientSecret,
              },
      });
    } catch (error) {
      if (error instanceof CardIntentFailure) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 500 },
        );
      }
      throw error;
    }
  }),
);
