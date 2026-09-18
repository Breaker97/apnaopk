import { z } from "zod";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { CheckoutAddressSchema } from "@/lib/validations";
import { customerActor } from "@/lib/orders/audit-order";
import { changePreorderShippingAddress } from "@/lib/orders/preorder-address";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { readPreorderManageToken } from "@/lib/payments/preorder-balance-link";

const BodySchema = z.object({
  /** The signed manage link, for a caller with no session. */
  accessToken: z.string().max(200).optional(),
  // Checkout's own address rules, so an address that could not be checked out
  // with cannot be edited in either.
  address: CheckoutAddressSchema,
});

/**
 * POST /api/orders/[id]/preorder-address
 *
 * Change where a pre-order ships, while it is still waiting. The rules — what
 * may change, when, and why the country and region may not — live in
 * `changePreorderShippingAddress`; this route only establishes who is asking.
 *
 * The signed-in owner, or a holder of the pre-order's MANAGE link. A balance
 * link does not open this: it is the link in every payment email, and moving a
 * parcel is not something a forwarded payment reminder should be able to do.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    // Moderate, not strict: a shopper correcting typos trips validation more
    // than once, and a strict bucket locks them out for a quarter of an hour.
    // The signed link is the protection; this only blunts a hammering.
    rateLimit: { action: "orders:preorder-address", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { accessToken, address } = await validateBody(request, BodySchema);

    const viaManageLink = readPreorderManageToken(accessToken) === params.id;
    if (!viaManageLink && !session?.user?.id) return notFoundResponse("Order");

    const result = await changePreorderShippingAddress({
      orderFilter: viaManageLink
        ? { _id: params.id }
        : { _id: params.id, customerId: session?.user?.id },
      address,
      auditContext: customerActor(request, session),
      by: viaManageLink ? "link" : "customer",
    });
    if (!result) return notFoundResponse("Order");

    return successResponse(await sanitizeOrderForCustomer(result.order.toObject()));
  },
);
