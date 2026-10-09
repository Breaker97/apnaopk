import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { normalizeSliderDocument, SLIDER_DOCUMENT_VERSION } from "@/lib/sliders/types";
import { publishSlider } from "@/lib/sliders/document-ops";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import {
  revalidateVendorSliders,
  vendorSliderLookup,
} from "@/lib/vendors/vendor-sliders";
import { VendorSlider } from "@/models/vendor-slider.model";

/**
 * POST /api/vendor/sliders/[id]/publish — the draft goes live (wherever the
 * landing page shows this slider), what was live goes to the history.
 * Without a draft the document comes back unchanged.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:publish" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const lookup = vendorSliderLookup(vendor._id, params.id);
    const stored = await VendorSlider.findOne(lookup).lean();
    if (!stored) throw new NotFoundError("Slider");
    const doc = normalizeSliderDocument(stored);
    const published = publishSlider(doc, new Date());
    if (!published) return successResponse(doc);
    const updated = await VendorSlider.findOneAndUpdate(
      lookup,
      {
        $set: {
          ...published.content,
          history: published.history,
          publishedAt: published.publishedAt,
          version: SLIDER_DOCUMENT_VERSION,
        },
        $unset: { draft: 1 },
      },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    revalidateVendorSliders(String(vendor._id));
    return successResponse(normalizeSliderDocument(updated));
  },
);
