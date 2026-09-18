import { z } from "zod";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { customerActor } from "@/lib/orders/audit-order";
import { cancelOrderForCustomer } from "@/lib/orders/customer-cancel";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { readPreorderManageToken } from "@/lib/payments/preorder-balance-link";

const BodySchema = z.object({
  /** The signed manage link from the shopper's delay notice. */
  accessToken: z.string().max(200).optional(),
});

/**
 * POST /api/orders/[id]/preorder-cancel
 *
 * Cancel a pre-order without signing in, from the link in its delay notice.
 *
 * A signed-in shopper could always cancel from their account; a guest could
 * not cancel at all, because their order is backed by a cart and the account
 * route matches a user. So when a pre-order's date slipped, the one shopper
 * least able to reach the store was also the one with no way to walk away —
 * exactly the moment consumer-protection rules (the US Mail Order Rule, and
 * most others) say the choice must be offered.
 *
 * Only a MANAGE token opens this. A balance token — the one in every payment
 * email — is refused, because paying a stranger's balance is harmless and
 * cancelling their order is not.
 *
 * The cascade is `cancelOrderForCustomer`, the same one the account route runs,
 * so a guest cancellation refunds, restocks and releases quota identically.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:preorder-cancel", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { accessToken } = await validateBody(request, BodySchema);

    const viaManageLink = readPreorderManageToken(accessToken) === params.id;
    if (!viaManageLink && !session?.user?.id) return notFoundResponse("Order");

    const result = await cancelOrderForCustomer({
      // The link is a pre-order capability; it opens nothing wider.
      orderFilter: viaManageLink
        ? { _id: params.id, hasPreorder: true }
        : { _id: params.id, customerId: session?.user?.id },
      auditContext: customerActor(request, session),
      createdBy: session?.user?.id,
      reason: viaManageLink
        ? "Pre-order cancelled by the customer from the pre-order link"
        : undefined,
    });
    if (!result) return notFoundResponse("Order");

    return successResponse({
      ...(await sanitizeOrderForCustomer(result.order.toObject())),
      ...(result.refund ? { refund: result.refund } : {}),
    });
  },
);
