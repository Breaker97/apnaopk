import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { queryAuditLogs } from "@/lib/audit";
import { AuditResource, AuditAction } from "@/models/audit-log.model";

/**
 * GET /api/admin/audit-logs
 * Get audit logs with filters
 */
export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const searchParams = request.nextUrl.searchParams;
  const resource = searchParams.get("resource") as AuditResource | undefined;
  const resourceId = searchParams.get("resourceId") || undefined;
  const userId = searchParams.get("userId") || undefined;
  const action = searchParams.get("action") as AuditAction | undefined;
  const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Math.min(200, Math.max(1, Number.isNaN(rawLimit) ? 50 : rawLimit));
  const rawSkip = parseInt(searchParams.get("skip") || "0", 10);
  const skip = Math.max(0, Number.isNaN(rawSkip) ? 0 : rawSkip);

  const { logs, total } = await queryAuditLogs({
    resource,
    resourceId,
    userId,
    action,
    limit,
    skip,
  });

  return successResponse({ logs, total });
});
