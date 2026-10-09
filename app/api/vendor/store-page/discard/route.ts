import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { vendorPageSections } from "@/lib/vendors/vendor-store-page-read";
import { VendorStorePage } from "@/models/vendor-store-page.model";

/** Throw away unpublished edits: the published sections go back into the draft. */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:discard" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");

    const doc = await VendorStorePage.findOne({ vendorId: vendor._id })
      .select("published")
      .lean();
    if (!doc?.published || !Array.isArray(doc.published.sections)) {
      throw new ValidationError(
        "Nothing published to restore — publish first or keep editing",
      );
    }

    const sections = vendorPageSections(doc.published.sections);
    await VendorStorePage.updateOne(
      { _id: doc._id },
      {
        $set: {
          draft: { sections, updatedAt: new Date(), updatedBy: session.user.id },
        },
      },
    );

    return successResponse({
      sections,
      isPublished: true,
      hasUnpublishedChanges: false,
    });
  },
);
