import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { countStaffNotificationAudience } from "@/lib/notifications/notifications";

/**
 * GET /api/admin/settings/notifications/audience
 * How many staff each staff event can reach, so Settings → Notifications can
 * say when a row reaches nobody (no one on the team can see inventory, say).
 */
export const GET = withApi({ auth: "admin" }, async () => {
  return successResponse({ staff: await countStaffNotificationAudience() });
});
