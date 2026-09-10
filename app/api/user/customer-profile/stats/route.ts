import { ensureCustomerProfile, refreshCustomerStats } from "@/lib/customers/customer";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";

/**
 * POST /api/user/customer-profile/stats
 * Force-refresh cached stats from source collections
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "user:customer-profile:stats", preset: "moderate" },
  },
  async ({ session }) => {
    // Ensure profile exists
    await ensureCustomerProfile(session.user.id);

    // Refresh stats
    const stats = await refreshCustomerStats(session.user.id);

    return successResponse({ stats });
  },
);
