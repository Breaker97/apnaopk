import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { vendorPageSections } from "@/lib/vendors/vendor-store-page-read";
import { VendorStorePage } from "@/models/vendor-store-page.model";

/**
 * Published versions of the vendor's landing page, newest first, in the shape
 * the builder's history dialog reads. Restoring is a client act: the
 * snapshot goes into the draft through the ordinary autosave.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:history", preset: "lenient" },
  },
  async ({ session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");

    const doc = await VendorStorePage.findOne({ vendorId: vendor._id })
      .select("published history")
      .lean();

    return successResponse({
      published: doc?.published
        ? {
            publishedAt: doc.published.publishedAt ?? null,
            sectionsCount: vendorPageSections(doc.published.sections).length,
          }
        : null,
      history: (doc?.history ?? []).map((entry, index) => {
        const sections = vendorPageSections(entry.sections);
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
