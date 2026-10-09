import * as z from "zod";
import { ServiceUnavailableError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { audit, createAuditContext } from "@/lib/audit";
import { META_CATALOG_ID_PATTERN } from "@/lib/meta-catalog/catalog-api";
import { readMetaCatalogFeed } from "@/lib/meta-catalog/feed-state";
import {
  startMetaCatalogSending,
  testMetaCatalogConnection,
  type MetaConnectionTest,
} from "@/lib/meta-catalog/live-connection";
import { saveMetaLiveCredentials } from "@/lib/meta-catalog/live-state";
import { metaCatalogPageState } from "@/lib/meta-catalog/page-state";

const CredentialsSchema = z.object({
  catalogId: z
    .string()
    .trim()
    .regex(META_CATALOG_ID_PATTERN, "The catalog ID is the number in Commerce Manager"),
  /** Absent: keep the saved token. Null: remove it. */
  accessToken: z
    .union([
      z
        .string()
        .trim()
        .min(20, "That does not look like an access token")
        .max(2000)
        .regex(/^\S+$/, "An access token has no spaces"),
      z.null(),
    ])
    .optional(),
});

/**
 * PUT /api/admin/meta-catalog/live
 * Save the catalog ID and the System User token (encrypted; never sent back),
 * then test them at once. A working pair starts the full check when live sync
 * is the chosen source.
 */
export const PUT = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:meta-catalog:live", preset: "strict" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, CredentialsSchema);
    let saved;
    try {
      saved = await saveMetaLiveCredentials({
        catalogId: body.catalogId,
        accessToken: body.accessToken,
        userId: session.user.id,
      });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === "string" && code.endsWith("_ENCRYPTION_KEY_NOT_CONFIGURED")) {
        throw new ServiceUnavailableError(
          "Set META_CATALOG_ENCRYPTION_KEY (32 or more characters) on the server before saving a token",
          undefined,
          "META_CATALOG_KEY_NOT_CONFIGURED",
        );
      }
      throw error;
    }

    if (saved.catalogChanged || saved.tokenChanged) {
      // The token itself is never written to the log, only that it changed.
      await audit(createAuditContext(request, session), {
        action: "SETTINGS_CHANGE",
        resource: "settings",
        resourceId: "metaCatalog",
        resourceName: "Settings: Meta catalog",
        changes: {
          before: { catalogId: saved.before.catalogId },
          after: { catalogId: saved.after.catalogId },
          fields: [
            ...(saved.catalogChanged ? ["catalogId"] : []),
            ...(saved.tokenChanged ? ["accessToken"] : []),
          ],
          summary: [
            saved.catalogChanged ? `Set the Meta catalog ID to ${saved.after.catalogId}` : null,
            saved.tokenChanged
              ? body.accessToken === null
                ? "Removed the Meta catalog access token"
                : "Replaced the Meta catalog access token"
              : null,
          ]
            .filter(Boolean)
            .join("; "),
        },
      });
    }

    let test: MetaConnectionTest | null = null;
    if (saved.after.catalogId && saved.after.tokenSet) {
      test = await testMetaCatalogConnection();
      if (test.ok) await startMetaCatalogSending();
    }
    return successResponse({ ...(await metaCatalogPageState(await readMetaCatalogFeed())), test });
  },
);
