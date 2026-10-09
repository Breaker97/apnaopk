import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { fetchTransferCatalog } from "@/lib/inventory/transfer-catalog";
import { requireVendorTransferAccess } from "@/lib/vendors/vendor-transfer-guard";

/** GET /api/vendor/transfers/catalog — see the admin route of the same name. */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorTransferAccess(request, session, "read", "vendor:transfers:catalog");
    return successResponse(
      await fetchTransferCatalog(
        session.user,
        new URL(request.url).searchParams,
      ),
    );
  },
);
