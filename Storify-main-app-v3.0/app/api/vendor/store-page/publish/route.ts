import { ConflictError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { buildPublishState } from "@/lib/storefront/pages/lifecycle";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import { SectionWriteError } from "@/lib/storefront/sections/write";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { revalidateVendorStorePage } from "@/lib/vendors/vendor-store-page-read";
import { prepareVendorSectionsForWrite } from "@/lib/vendors/vendor-store-page-write";
import { VendorStorePage } from "@/models/vendor-store-page.model";

/**
 * Publish the vendor's draft: it goes live on /vendors/<slug> at once (no
 * admin review), and what was live moves to the head of the history. The
 * same compare-and-set as the admin's publish, so a concurrent autosave is
 * never silently reverted to an older draft.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:publish" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const vendorId = String(vendor._id);

    let sections: SectionInstance[] = [];
    let publishedAt = new Date();
    let docId = "";
    for (let attempt = 0; ; attempt += 1) {
      const doc = await VendorStorePage.findOne({ vendorId: vendor._id }).lean();
      if (!doc?.draft || !Array.isArray(doc.draft.sections)) {
        throw new ValidationError("There is no draft to publish yet");
      }

      // The draft was checked when saved; checked again because products
      // change hands and sections leave the vendor catalogue over time.
      try {
        sections = await prepareVendorSectionsForWrite(
          doc.draft.sections,
          vendorId,
        );
      } catch (error) {
        if (error instanceof SectionWriteError) {
          throw new ValidationError(`Draft failed validation: ${error.message}`);
        }
        throw error;
      }

      const now = new Date();
      const state = buildPublishState(
        sections,
        doc.published && Array.isArray(doc.published.sections)
          ? {
              sections: doc.published.sections as SectionInstance[],
              publishedAt: doc.published.publishedAt,
              publishedBy: doc.published.publishedBy,
            }
          : null,
        (doc.history ?? []) as {
          sections: SectionInstance[];
          publishedAt?: Date;
          publishedBy?: string;
        }[],
        session.user.id,
        now,
      );
      publishedAt = now;
      docId = String(doc._id);

      const draftUpdatedAt = doc.draft.updatedAt;
      const result = await VendorStorePage.updateOne(
        {
          _id: doc._id,
          ...(draftUpdatedAt ? { "draft.updatedAt": draftUpdatedAt } : {}),
        },
        {
          $set: {
            published: state.published,
            history: state.history,
            "draft.sections": sections,
            takedown: null,
          },
        },
      );
      if (result.modifiedCount > 0) break;
      if (attempt >= 2) {
        throw new ConflictError("The draft changed while publishing — try again");
      }
    }

    revalidateVendorStorePage(vendorId);

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "vendor",
      resourceId: vendorId,
      resourceName: vendor.storeName,
      changes: {
        summary: `Published the store landing page (${sections.length} sections) [${docId}]`,
      },
    });

    return successResponse({
      publishedAt: publishedAt.toISOString(),
      isPublished: true,
      hasUnpublishedChanges: false,
    });
  },
);
