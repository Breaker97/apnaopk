import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { fetchTransferCatalog } from "@/lib/inventory/transfer-catalog";

/**
 * GET /api/admin/transfers/catalog?fromLocationId=&toLocationId=&search=&page=&limit=
 *
 * What can be moved out of one location: every variant — and every product
 * without variants — holding stock there, a page at a time.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:catalog",
      "lenient",
      session.user.role,
    );

    return successResponse(
      await fetchTransferCatalog(
        session.user,
        new URL(request.url).searchParams,
      ),
    );
  },
);
