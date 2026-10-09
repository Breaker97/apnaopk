import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  runTransferAction,
  transferDetailResponse,
} from "@/lib/inventory/transfer-api";
import { requireVendorTransferAccess } from "@/lib/vendors/vendor-transfer-guard";

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await requireVendorTransferAccess(request, session, "read", "vendor:transfers:detail");
    return successResponse(
      await transferDetailResponse(session.user, params.id),
    );
  },
);

export const PATCH = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await requireVendorTransferAccess(request, session, "write", "vendor:transfers:update");
    const { data, message } = await runTransferAction(
      request,
      session,
      params.id,
    );
    return successResponse(data, message);
  },
);
