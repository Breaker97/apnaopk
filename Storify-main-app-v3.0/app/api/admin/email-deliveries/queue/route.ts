import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  cancelStuckEmailDeliveries,
  getEmailQueueHealth,
} from "@/lib/email/email-queue";

/**
 * GET /api/admin/email-deliveries/queue
 * Emails stuck waiting for the retry job, and whether that job runs here.
 */
export const GET = withApi({ auth: "admin" }, async () => {
  return successResponse(await getEmailQueueHealth());
});

/**
 * POST /api/admin/email-deliveries/queue
 * Cancel the stuck emails, so they never go out late.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:email-deliveries:cancel", preset: "moderate" },
  },
  async () => {
    const cancelled = await cancelStuckEmailDeliveries();
    return successResponse({ cancelled });
  },
);
