import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import {
  applyThemeStarter,
  type StarterMode,
} from "@/lib/storefront/themes/apply-starter";
import {
  getThemeDefaults,
  THEME_MANIFESTS,
} from "@/lib/storefront/themes/registry";
import { normalizeThemeTokens } from "@/lib/storefront/themes/tokens";
import { getSettings } from "@/models/settings.model";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

/**
 * How far an activation carries the theme's starter layout.
 *
 * - `keep`   — only the design changes; existing pages are untouched. (A
 *              FRESH install still gets the starter seeded as its draft:
 *              there is nothing to keep.)
 * - `draft`  — the starter replaces the DRAFT; shoppers see nothing until
 *              the admin publishes from Customize.
 * - `publish`— the starter goes live immediately. The layout it replaces is
 *              pushed onto version history, so it is one click to restore.
 */
const STARTER_MODES = ["keep", "draft", "publish"] as const;

function readStarterMode(body: { starter?: unknown } | null): StarterMode {
  const value = body?.starter;
  return typeof value === "string" &&
    (STARTER_MODES as readonly string[]).includes(value)
    ? (value as StarterMode)
    : "keep";
}

/**
 * Switch the active theme. Instant, reversible, content-preserving — the
 * mechanics live in `applyThemeStarter`, shared verbatim with the install
 * wizard; this route adds the admin gate, the mode parse, and the audit.
 */
const ActivateThemeSchema = z.object({
  theme: z.string().max(80).optional(),
  starter: z.unknown().optional(),
});

export const POST = withApi(
  {
    auth: "admin",
    // Each template demo deployment IS its template (DEMO_TEMPLATE_URLS
    // cross-links the hosts), so a demo visitor switching themes would break
    // the host's identity for everyone — and it rewrites live layouts.
    demo: "block-mutations",
    rateLimit: { action: "admin:theme-settings:activate" },
  },
  async ({ request, session }) => {
    const body = await validateOptionalBody(request, ActivateThemeSchema);
    const manifest = THEME_MANIFESTS.find(
      (candidate) => candidate.id === body?.theme,
    );
    if (!manifest || manifest.status !== "stable") {
      throw new ValidationError("Unknown theme");
    }
    const mode = readStarterMode(body);

    const { seededTemplates, draftedTemplates, publishedTemplates } =
      await applyThemeStarter(manifest, mode, session.user.id);

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "settings",
      resourceId: "theme",
      resourceName: manifest.id,
      changes: {
        summary:
          publishedTemplates.length > 0
            ? `Activated theme "${manifest.id}" and published its starter (${publishedTemplates.join(", ")})`
            : draftedTemplates.length > 0
              ? `Activated theme "${manifest.id}" and drafted its starter (${draftedTemplates.join(", ")})`
              : `Activated theme "${manifest.id}"`,
      },
    });

    // The NEW theme's stored setting values (kept from any earlier stint).
    const settings = await getSettings();
    const stored =
      settings.onlineStore?.themeSettings &&
      typeof settings.onlineStore.themeSettings === "object"
        ? settings.onlineStore.themeSettings[manifest.id]
        : undefined;

    return successResponse({
      theme: manifest.id,
      values: normalizeThemeTokens(getThemeDefaults(manifest), stored),
      seededTemplates,
      draftedTemplates,
      publishedTemplates,
    });
  },
);
