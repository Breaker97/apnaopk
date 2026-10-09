import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { fetchActivityLogList } from "@/lib/activity-log/list";
import { ActivityLogQuerySchema } from "@/lib/activity-log/query";

/**
 * GET /api/admin/audit-logs
 *
 * The Activity Log, every row of it. Admin only: platform staff never read the
 * log, and a vendor reads its own team's part through `/api/vendor/activity-log`.
 *
 * Filters are validated, not cast: an unknown `action` or `resource` is a 400
 * rather than a query that silently matches nothing. A bare request reads the
 * last 30 days; a record's own history (`resource` + `resourceId`) passes
 * `date=all`.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:audit-logs:list", preset: "lenient" },
  },
  async ({ request }) => {
    const query = validateQuery(request, ActivityLogQuerySchema);
    const list = await fetchActivityLogList(query, { kind: "admin" });
    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
