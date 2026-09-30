import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { ValidationError } from "@/lib/api/errors";
import { appUrlForRequest } from "@/lib/app-url";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { readOrderPayToken } from "@/lib/payments/preorder-balance-link";
import { createOrderPayPayPalOrder } from "@/lib/payments/order-pay";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
  /** The signed pay link, for a caller with no session — see that route. */
  accessToken: z.string().max(300).optional(),
});

/**
 * POST /api/orders/[id]/pay/paypal
 *
 * Start paying an unpaid order with PayPal. Returns the approval URL the page
 * sends the shopper to; PayPal brings them back where they started and the
 * shared capture route records the payment.
 *
 * The return address is built here from the request and the order, never taken
 * from the body: a caller-chosen return URL on a payment redirect is an open
 * redirect with PayPal's name on the way through it.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:pay:paypal", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { locale, accessToken } = await validateBody(request, BodySchema);

    const viaAccessLink = readOrderPayToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) {
      throw new ValidationError("Order not found");
    }

    // The locale lands in a URL path, so only a locale the app actually has
    // may be written into it.
    const activeLocale = locale && isValidLocale(locale) ? locale : defaultLocale;
    const origin = appUrlForRequest(request);
    const back = viaAccessLink
      ? `${origin}/${activeLocale}/order/pay/${encodeURIComponent(String(accessToken))}`
      : `${origin}/${activeLocale}/account/orders/${encodeURIComponent(params.id)}`;

    const result = await createOrderPayPayPalOrder({
      orderId: params.id,
      customerId: viaAccessLink ? undefined : session?.user?.id,
      viaAccessLink,
      returnUrl: `${back}?paypalOrderPay=return`,
      cancelUrl: `${back}?paypalOrderPay=cancel`,
    });
    return successResponse(result);
  },
);
