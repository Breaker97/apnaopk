import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { fetchActivityLogEntry } from "@/lib/activity-log/list";

/**
 * GET /api/admin/audit-logs/[id]
 *
 * One entry in full, with the before and after values the list leaves out and
 * the request it came from. Loaded when a row is opened in the detail sheet.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:audit-logs:detail", preset: "lenient" },
  },
  async ({ params }) => {
    const entry = await fetchActivityLogEntry(params.id, { kind: "admin" });
    if (!entry) throw new NotFoundError("Activity log entry");
    return successResponse(entry);
  },
);
