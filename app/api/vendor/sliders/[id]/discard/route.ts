import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { normalizeSliderDocument } from "@/lib/sliders/types";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { vendorSliderLookup } from "@/lib/vendors/vendor-sliders";
import { VendorSlider } from "@/models/vendor-slider.model";

/** POST /api/vendor/sliders/[id]/discard — drops the draft; what is live stays. */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:discard" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const updated = await VendorSlider.findOneAndUpdate(
      vendorSliderLookup(vendor._id, params.id),
      { $unset: { draft: 1 } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    return successResponse(normalizeSliderDocument(updated));
  },
);
