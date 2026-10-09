import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import { rotateMetaCatalogFeedToken } from "@/lib/meta-catalog/feed-state";
import { metaCatalogPageState } from "@/lib/meta-catalog/page-state";

/**
 * POST /api/admin/meta-catalog/rotate
 * A new feed URL. The old one answers 404 from this moment, so Commerce
 * Manager must be given the new one.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:meta-catalog:rotate", preset: "strict" },
  },
  async ({ request, session }) => {
    const state = await rotateMetaCatalogFeedToken(session.user.id);

    // The token itself is never written to the log.
    await audit(createAuditContext(request, session), {
      action: "SETTINGS_CHANGE",
      resource: "settings",
      resourceId: "metaCatalog",
      resourceName: "Settings: Meta catalog",
      changes: {
        fields: ["feedUrl"],
        summary: "Generated a new Meta catalog feed URL; the old one stopped working",
      },
    });

    // Live sync's picture links carry this token too; its watcher re-sends
    // them on the next run.
    return successResponse(await metaCatalogPageState(state));
  },
);
