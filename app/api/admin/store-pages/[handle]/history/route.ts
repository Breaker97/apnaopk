import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { resolveAdminPageRef } from "@/lib/storefront/pages/handles";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { StorePage } from "@/models/store-page.model";

/**
 * Published snapshots for the version-history panel, newest first. Each
 * entry ships its full sections so "Restore" is a pure client act: put the
 * snapshot into the draft (through the ordinary autosave PATCH) and let the
 * admin review and publish — history itself is never rewritten.
 */
export const GET = withApi<{ handle: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:store-pages:history", preset: "lenient" },
  },
  async ({ params }) => {
    const { handle } = params;
    const ref = resolveAdminPageRef(handle);
    if (!ref) {
      throw new ValidationError("Invalid page handle");
    }

    const doc = await StorePage.findOne({ key: ref.key })
      .select("published history")
      .lean();
    if (!doc) {
      throw new NotFoundError("Page not found");
    }

    return successResponse({
      published: doc.published
        ? {
            publishedAt: doc.published.publishedAt ?? null,
            sectionsCount: sanitizeSectionInstances(doc.published.sections)
              .length,
          }
        : null,
      history: (doc.history ?? []).map((entry, index) => {
        const sections = sanitizeSectionInstances(entry.sections);
        return {
          index,
          publishedAt: entry.publishedAt ?? null,
          sectionsCount: sections.length,
          sections,
        };
      }),
    });
  },
);
