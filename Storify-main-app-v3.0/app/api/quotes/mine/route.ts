import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { fetchCustomerQuotes } from "@/lib/quotes/quotes";

/**
 * GET /api/quotes/mine — the signed-in shopper's own quote requests.
 *
 * What answers "I asked for a price, now what?": every request they have sent,
 * what the merchant came back with, and whether that price is still good.
 * Scoped to `session.user.id` and nothing else — a request sent while signed
 * out joins the list when its sender signs in with the same address
 * (claimGuestCustomerData), which is the only way one is ever attached.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "quotes:mine", preset: "lenient" },
  },
  async ({ session }) => {
    return successResponse(await fetchCustomerQuotes(session.user.id));
  },
);
