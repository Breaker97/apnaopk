import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { audit, createAuditContext } from "@/lib/audit";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";
import {
  CUSTOM_CSS_MAX_LENGTH,
  normalizeCustomCss,
} from "@/lib/storefront/themes/custom-css";
import { getActiveThemeManifest } from "@/lib/storefront/themes/registry";
import { getSettings, Settings } from "@/models/settings.model";
import { z } from "zod";

/**
 * Save the ACTIVE theme's custom CSS sheet. Same contract as the token
 * route beside it: written here and nowhere else, stored per theme id so a
 * switch keeps every theme's sheet, neutralized on the way in so the
 * storefront can print it verbatim.
 */
const CustomCssSchema = z.object({
  css: z.string().max(CUSTOM_CSS_MAX_LENGTH),
});

export const PATCH = withApi(
  {
    auth: "admin",
    // Settings write: a demo visitor must not restyle the shared storefront.
    demo: "block-mutations",
    rateLimit: { action: "admin:theme-settings:custom-css" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, CustomCssSchema);

    const settings = await getSettings();
    const manifest = getActiveThemeManifest(settings.onlineStore?.activeTheme);
    const css = normalizeCustomCss(body.css);

    await Settings.updateOne(
      {},
      {
        $set: {
          [`onlineStore.customCss.${manifest.id}`]: css,
          "onlineStore.activeTheme": manifest.id,
        },
      },
    );

    revalidateSettingsContent();

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "settings",
      resourceId: "theme-custom-css",
      resourceName: manifest.id,
      changes: { summary: `Updated ${manifest.id} custom CSS` },
    });

    return successResponse({ theme: manifest.id, css });
  },
);
