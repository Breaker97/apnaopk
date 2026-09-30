import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { connectDB } from "@/lib/db";
import { storeCreditHistory, storeCreditSummary } from "@/lib/store-credit/store-credit";

/**
 * The shopper's own store credit (R8): what they can spend in each currency,
 * the part that expires next, and what added to it or took from it.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "user:store-credit", preset: "lenient" } },
  async ({ session }) => {
    await connectDB();
    const [balances, history] = await Promise.all([
      storeCreditSummary(session.user.id),
      storeCreditHistory(session.user.id, { limit: 50 }),
    ]);
    return successResponse({ balances, history });
  },
);
