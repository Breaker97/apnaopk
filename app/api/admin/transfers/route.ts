import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  createTransferFromRequest,
  listTransfersResponse,
} from "@/lib/inventory/transfer-api";

/**
 * GET /api/admin/transfers
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
      "admin:transfers:list",
      "lenient",
      session.user.role,
    );

    return successResponse(
      await listTransfersResponse(
        session.user,
        new URL(request.url).searchParams,
      ),
    );
  },
);

/**
 * POST /api/admin/transfers
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.CREATE_INVENTORY,
        STAFF_PERMISSIONS.MANAGE_INVENTORY,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:create",
      "moderate",
      session.user.role,
    );

    return successResponse(
      await createTransferFromRequest(request, session),
      "Transfer created",
      201,
    );
  },
);
