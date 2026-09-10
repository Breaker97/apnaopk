import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";
import {
  getActiveThemeManifest,
  getThemeDefaults,
} from "@/lib/storefront/themes/registry";
import { normalizeThemeTokens } from "@/lib/storefront/themes/tokens";
import { getSettings, Settings } from "@/models/settings.model";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

/**
 * Save the ACTIVE theme's tokens. Values are normalized against the token
 * schema over the manifest's defaults — unknown keys dropped, numbers
 * clamped, colors canonical — so the document only ever stores what the
 * schema describes. Written here and nowhere else; the big settings PUT
 * does not accept `onlineStore`.
 *
 * Stored per theme id, so a theme switch keeps every theme's configuration
 * intact. A v1 flat document migrates on read and is rewritten in the token
 * shape by the first save.
 */
// `values` is validated against the active theme's token schema below.
const ThemeValuesSchema = z.object({ values: z.unknown().optional() });

export const PATCH = withApi(
  {
    auth: "admin",
    // Settings write: a demo visitor must not restyle the shared storefront.
    demo: "block-mutations",
    rateLimit: { action: "admin:theme-settings:save" },
  },
  async ({ request, session }) => {
    const body = await validateOptionalBody(request, ThemeValuesSchema);

    const settings = await getSettings();
    const manifest = getActiveThemeManifest(settings.onlineStore?.activeTheme);
    const values = normalizeThemeTokens(getThemeDefaults(manifest), body.values);

    await Settings.updateOne(
      {},
      {
        $set: {
          [`onlineStore.themeSettings.${manifest.id}`]: values,
          "onlineStore.activeTheme": manifest.id,
        },
      },
    );

    revalidateSettingsContent();

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "settings",
      resourceId: "theme-settings",
      resourceName: manifest.id,
      changes: { summary: `Updated ${manifest.id} theme settings` },
    });

    return successResponse({ theme: manifest.id, values });
  },
);
