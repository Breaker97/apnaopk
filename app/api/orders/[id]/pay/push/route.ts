import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { ValidationError } from "@/lib/api/errors";
import { appUrlForRequest } from "@/lib/app-url";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { readOrderPayToken } from "@/lib/payments/preorder-balance-link";
import { resendOrderPaymentPush } from "@/lib/payments/order-pay-push";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
  /** The signed pay link, for a caller with no session — see that route. */
  accessToken: z.string().max(300).optional(),
});

/**
 * POST /api/orders/[id]/pay/push
 *
 * Send the mobile-money prompt again for an order whose first one went
 * unanswered. Same order, same number, same amount — see
 * `lib/payments/order-pay-push.ts` for why it refuses while the previous
 * prompt may still be live.
 *
 * Strict rather than moderate: every call puts a prompt on somebody's phone,
 * and a caller who can loop this is a caller who can make a stranger's handset
 * ring all afternoon.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:pay:push", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const { locale, accessToken } = await validateBody(request, BodySchema);

    const viaAccessLink = readOrderPayToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) {
      throw new ValidationError("Order not found");
    }

    const activeLocale = locale && isValidLocale(locale) ? locale : defaultLocale;
    const result = await resendOrderPaymentPush({
      orderId: params.id,
      customerId: viaAccessLink ? undefined : session?.user?.id,
      viaAccessLink,
      origin: appUrlForRequest(request),
      locale: activeLocale,
    });
    return successResponse(result);
  },
);
