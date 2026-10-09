import * as z from "zod";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { customerActor } from "@/lib/orders/audit-order";
import { confirmAddressByCustomer } from "@/lib/orders/address-hold";
import { readOrderAddressToken } from "@/lib/payments/preorder-balance-link";

const BodySchema = z.object({
  accessToken: z.string().max(200).optional(),
});

/**
 * POST /api/orders/[id]/address/confirm
 *
 * The customer says the address on a held order is right as it is. The hold
 * stays — a courier already refused it — and the store is asked to decide.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "optional",
    rateLimit: { action: "orders:address-confirm", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { accessToken } = await validateBody(request, BodySchema);
    const viaLink = readOrderAddressToken(accessToken) === params.id;
    if (!viaLink && !session?.user?.id) return notFoundResponse("Order");

    const order = await confirmAddressByCustomer({
      orderFilter: viaLink
        ? { _id: params.id }
        : { _id: params.id, customerId: session?.user?.id },
      actor: { id: session?.user?.id, context: customerActor(request, session) },
    });
    if (!order) return notFoundResponse("Order");
    return successResponse({ confirmed: true }, "Thanks — the store will check your address");
  },
);
