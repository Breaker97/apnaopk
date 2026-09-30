import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { ValidationError } from "@/lib/api/errors";
import { readOrderPayToken } from "@/lib/payments/preorder-balance-link";
import { createOrderPayIntent } from "@/lib/payments/order-pay";

const BodySchema = z.object({
  locale: z.string().max(10).optional(),
  /**
   * The signed "pay now" link from the failure email, for a caller with no
   * session — see `lib/payments/order-pay.ts`.
   */
  accessToken: z.string().max(300).optional(),
});

/**
 * POST /api/orders/[id]/pay
 *
 * Start a card payment for everything an unpaid order still owes: the answer
 * to a mobile-money push nobody approved, a bank transfer that never came, or
 * a checkout the shopper left at the gateway.
 *
 * Two ways in and exactly two: the shopper is signed in and the order is
 * theirs, or they hold a link signed for this order. A pay link expires after
 * a week, which is checked in the token itself.
 *
 * `auth: "optional"` rather than public, so a signed-in caller gets their own
 * rate-limit bucket and an anonymous one is limited by IP. Moderate rather
 * than strict for the same reason the balance route is: a shopper whose first
 * card is refused must be able to try a second.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:pay:intent", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { accessToken } = await validateBody(request, BodySchema);

    const viaAccessLink = readOrderPayToken(accessToken) === params.id;
    if (!viaAccessLink && !session?.user?.id) {
      throw new ValidationError("Order not found");
    }

    const intent = await createOrderPayIntent({
      orderId: params.id,
      customerId: viaAccessLink ? undefined : session?.user?.id,
      viaAccessLink,
      customerEmail: session?.user?.email || undefined,
    });
    return successResponse(intent);
  },
);
