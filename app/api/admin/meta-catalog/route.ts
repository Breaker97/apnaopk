import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { audit, createAuditContext } from "@/lib/audit";
import {
  readMetaCatalogFeed,
  setMetaCatalogFeedEnabled,
  setMetaCatalogSource,
  type MetaCatalogFeedState,
} from "@/lib/meta-catalog/feed-state";
import { startMetaCatalogSending } from "@/lib/meta-catalog/live-connection";
import { forgetMetaLiveSyncActive } from "@/lib/meta-catalog/live-state";
import { metaCatalogPageState as pageState } from "@/lib/meta-catalog/page-state";

/**
 * GET /api/admin/meta-catalog
 * The Meta catalog as Settings → Meta catalog shows it.
 */
export const GET = withApi({ auth: "admin" }, async () => successResponse(await pageState()));

const UpdateSchema = z
  .object({ enabled: z.boolean().optional(), source: z.enum(["feed", "live"]).optional() })
  .refine((body) => body.enabled !== undefined || body.source !== undefined, {
    message: "Nothing to change",
  });

const SOURCE_LABEL = { feed: "the feed URL", live: "live sync (Catalog API)" } as const;

function isLive(state: MetaCatalogFeedState) {
  return state.enabled && state.source === "live";
}

/**
 * PATCH /api/admin/meta-catalog
 * Switch Meta's access on or off, or choose how it gets the products. The
 * first switch-on creates the feed's URL (its token also signs the picture
 * links live sync sends). Choosing live sync starts the full check.
 */
export const PATCH = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:meta-catalog:update" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, UpdateSchema);
    const start = await readMetaCatalogFeed();
    let after = start;
    if (body.enabled !== undefined) {
      after = (await setMetaCatalogFeedEnabled(body.enabled, session.user.id)).after;
    }
    if (body.source !== undefined) {
      after = (await setMetaCatalogSource(body.source, session.user.id)).after;
    }
    forgetMetaLiveSyncActive();

    const fields = [
      ...(start.enabled !== after.enabled ? ["enabled"] : []),
      ...(start.source !== after.source ? ["source"] : []),
    ];
    if (fields.length > 0) {
      const summaries: string[] = [];
      if (start.enabled !== after.enabled) {
        const what = after.source === "live" ? "Meta catalog live sync" : "Meta catalog feed";
        summaries.push(
          after.enabled
            ? start.token
              ? `Turned the ${what} on`
              : `Turned the ${what} on and created its URL`
            : `Turned the ${what} off`,
        );
      }
      if (start.source !== after.source) {
        summaries.push(`Meta now gets the products through ${SOURCE_LABEL[after.source]}`);
      }
      await audit(createAuditContext(request, session), {
        action: "SETTINGS_CHANGE",
        resource: "settings",
        resourceId: "metaCatalog",
        resourceName: "Settings: Meta catalog",
        changes: {
          before: { enabled: start.enabled, source: start.source },
          after: { enabled: after.enabled, source: after.source },
          fields,
          summary: summaries.join("; "),
        },
      });
    }

    if (isLive(after) && !isLive(start)) await startMetaCatalogSending();

    return successResponse(await pageState(after));
  },
);
