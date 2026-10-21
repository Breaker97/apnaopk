import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { posReturnOptions } from "@/lib/pos/pos-returns";

/**
 * GET /api/pos/returns/options?orderId= — what of a counter sale can come back
 * (each line's returnable count, by the store's return policy) and how this
 * cashier can give the money back.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:returns:read", preset: "lenient" } },
  async ({ request, session }) => {
    const orderId = new URL(request.url).searchParams.get("orderId")?.trim();
    if (!orderId) throw new ValidationError("Choose a sale");
    return successResponse(await posReturnOptions(session.user, orderId));
  },
);
