import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  createTransferFromRequest,
  listTransfersResponse,
} from "@/lib/inventory/transfer-api";
import { requireVendorTransferAccess } from "@/lib/vendors/vendor-transfer-guard";

/** GET /api/vendor/transfers — the vendor's transfers between their own locations. */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorTransferAccess(request, session, "read", "vendor:transfers:list");
    return successResponse(
      await listTransfersResponse(
        session.user,
        new URL(request.url).searchParams,
      ),
    );
  },
);

/** POST /api/vendor/transfers */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorTransferAccess(request, session, "write", "vendor:transfers:create");
    return successResponse(
      await createTransferFromRequest(request, session),
      "Transfer created",
      201,
    );
  },
);
