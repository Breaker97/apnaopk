import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { ValidationError } from "@/lib/api/errors";
import { appUrlForRequest } from "@/lib/app-url";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { readPreorderBalanceToken } from "@/lib/payments/preorder-balance-link";
import { createPreorderBalancePayPalOrder } from "@/lib/payments/preorder-balance-paypal";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
  /** The signed balance link, for a caller with no session — see that route. */
  accessToken: z.string().max(200).optional(),
});

/**
 * POST /api/orders/[id]/preorder-balance/paypal
 *
 * Start paying a pre-order balance with PayPal. Returns the approval URL the
 * page sends the shopper to; PayPal brings them back to where they started,
 * and the capture route records the payment.
 *
 * The same two ways in as the card balance route — the signed-in owner, or a
 * holder of the signed link — and for the same reason: a guest's order is
 * backed by a cart, so only the link can speak for them.
 *
 * The return address is built here from the request and the order, never taken
 * from the body. A caller-chosen return URL on a payment redirect is an open
 * redirect with PayPal's name on the way through it.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:preorder-balance:paypal", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { locale, accessToken } = await validateBody(request, BodySchema);

    const viaAccessLink = readPreorderBalanceToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) {
      throw new ValidationError("Order not found");
    }

    // The locale lands in a URL path, so only a locale the app actually has
    // may be written into it.
    const activeLocale = locale && isValidLocale(locale) ? locale : defaultLocale;
    const origin = appUrlForRequest(request);
    const back = viaAccessLink
      ? `${origin}/${activeLocale}/pre-order/balance/${encodeURIComponent(String(accessToken))}`
      : `${origin}/${activeLocale}/account/orders/${encodeURIComponent(params.id)}`;

    const result = await createPreorderBalancePayPalOrder({
      orderId: params.id,
      customerId: viaAccessLink ? undefined : session?.user?.id,
      viaAccessLink,
      returnUrl: `${back}?paypalBalance=return`,
      cancelUrl: `${back}?paypalBalance=cancel`,
    });
    return successResponse(result);
  },
);
