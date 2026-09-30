import { withApi } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import { canIssueRefunds } from "@/lib/access/rbac";
import { getSettings } from "@/models/settings.model";
import { loadReturnForRoute } from "@/lib/returns/return-route-access";
import { searchExchangeProducts } from "@/lib/returns/return-exchange";

/**
 * What the store can send in exchange for this return (R7): the returning
 * seller's products that can go out as one — see `searchExchangeProducts`.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "admin:returns:exchange:products", preset: "lenient" },
  },
  async ({ request, params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can exchange a return");
    }
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "admin",
      user: session.user,
      id: params.id,
      mode: "read",
    });
    if (!returnRequest) return notFoundResponse("Return request");
    const search = new URL(request.url).searchParams.get("search") || "";
    return successResponse(
      await searchExchangeProducts({
        returnRequest,
        search,
        settings: await getSettings(),
      }),
    );
  },
);
