import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  runTransferAction,
  transferDetailResponse,
} from "@/lib/inventory/transfer-api";

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:detail",
      "lenient",
      session.user.role,
    );

    return successResponse(
      await transferDetailResponse(session.user, params.id),
    );
  },
);

export const PATCH = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_INVENTORY, STAFF_PERMISSIONS.MANAGE_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:update",
      "moderate",
      session.user.role,
    );

    const { data, message } = await runTransferAction(
      request,
      session,
      params.id,
    );
    return successResponse(data, message);
  },
);
