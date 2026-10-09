import { ConflictError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import { startMetaCatalogSending } from "@/lib/meta-catalog/live-connection";
import { metaCatalogPageState } from "@/lib/meta-catalog/page-state";

/**
 * POST /api/admin/meta-catalog/live/sync
 * "Sync everything now": every item of every product the storefront shows
 * goes to Meta again, whatever was sent before, and items of hidden or
 * deleted products are removed.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:meta-catalog:sync", preset: "strict" },
  },
  async ({ request, session }) => {
    if (!(await startMetaCatalogSending({ everything: true }))) {
      throw new ConflictError("Live sync is off or paused");
    }
    await audit(createAuditContext(request, session), {
      action: "BULK_ACTION",
      resource: "settings",
      resourceId: "metaCatalog",
      resourceName: "Settings: Meta catalog",
      changes: { summary: "Started sending the whole catalog to Meta again" },
    });
    return successResponse(await metaCatalogPageState());
  },
);
