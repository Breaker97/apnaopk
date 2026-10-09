import * as z from "zod";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { CheckoutAddressSchema } from "@/lib/validations";
import { customerActor } from "@/lib/orders/audit-order";
import { changeOrderShippingAddress } from "@/lib/orders/order-address";
import { readOrderAddressToken } from "@/lib/payments/preorder-balance-link";

const BodySchema = z.object({
  /** The signed address link, for a caller with no session. */
  accessToken: z.string().max(200).optional(),
  address: CheckoutAddressSchema,
});

/**
 * POST /api/orders/[id]/address
 *
 * Correct the delivery address of an order on an address hold. The signed-in
 * owner, or a holder of the order's ADDRESS link — the one in the "we can't
 * deliver to your address" email. An address the courier still can't find is
 * not saved: the response says why, with a suggestion when there is one.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:address-correct", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { accessToken, address } = await validateBody(request, BodySchema);

    const viaLink = readOrderAddressToken(accessToken) === params.id;
    if (!viaLink && !session?.user?.id) return notFoundResponse("Order");

    const result = await changeOrderShippingAddress({
      orderFilter: viaLink
        ? { _id: params.id }
        : { _id: params.id, customerId: session?.user?.id },
      address,
      by: viaLink ? "address-link" : "customer",
      auditContext: customerActor(request, session),
      actorId: session?.user?.id,
    });
    if (!result) return notFoundResponse("Order");

    return successResponse(
      result.saved
        ? { saved: true, released: result.released, verification: result.verification }
        : { saved: false, verification: result.verification },
      result.saved
        ? "Delivery address updated"
        : result.verification.checkedWith === "carrier"
          ? "The courier still can't find this address"
          : "Check this address",
    );
  },
);
