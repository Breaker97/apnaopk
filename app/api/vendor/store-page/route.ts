import * as z from "zod";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateOptionalBody } from "@/lib/api/validate";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { sectionsEqual } from "@/lib/storefront/pages/lifecycle";
import { SectionWriteError } from "@/lib/storefront/sections/write";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { prepareVendorSectionsForWrite } from "@/lib/vendors/vendor-store-page-write";
import { VendorStorePage } from "@/models/vendor-store-page.model";

// The sections themselves are validated by prepareVendorSectionsForWrite.
const DraftBodySchema = z.object({ sections: z.unknown().optional() });

/**
 * Draft autosave for the signed-in vendor's landing page — the Vendor CMS
 * builder's PATCH. The document is created on the first save. Not audited,
 * like the admin's draft saves: publishing is the act that reaches shoppers.
 */
export const PATCH = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:save" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const vendorId = String(vendor._id);

    const body = await validateOptionalBody(request, DraftBodySchema);

    let sections;
    try {
      sections = await prepareVendorSectionsForWrite(body.sections, vendorId);
    } catch (error) {
      if (error instanceof SectionWriteError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }

    const now = new Date();
    const doc = await VendorStorePage.findOneAndUpdate(
      { vendorId: vendor._id },
      {
        $set: {
          draft: { sections, updatedAt: now, updatedBy: session.user.id },
        },
        $setOnInsert: { published: null, history: [] },
      },
      { returnDocument: "after", upsert: true },
    ).lean();

    return successResponse({
      draftUpdatedAt: now.toISOString(),
      isPublished: Boolean(doc?.published),
      hasUnpublishedChanges: !sectionsEqual(sections, doc?.published?.sections),
    });
  },
);
