import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { listMetaCatalogRejected } from "@/lib/meta-catalog/live-dto";

/**
 * GET /api/admin/meta-catalog/live/rejected?page=1&pageSize=10
 * The products Meta refused items of, with its reason, newest first.
 */
export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(params.get("pageSize")) || 10)));
  const { rows, total } = await listMetaCatalogRejected({ page, pageSize });
  return successResponse({
    rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});
