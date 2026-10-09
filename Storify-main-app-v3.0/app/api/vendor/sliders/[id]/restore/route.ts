import * as z from "zod";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { MAX_SLIDER_HISTORY, normalizeSliderDocument } from "@/lib/sliders/types";
import { restoreSliderVersion } from "@/lib/sliders/document-ops";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { vendorSlides, vendorSliderLookup } from "@/lib/vendors/vendor-sliders";
import { VendorSlider } from "@/models/vendor-slider.model";

const BodySchema = z.object({
  /** Position in the history, newest first. */
  index: z.number().int().min(0).max(MAX_SLIDER_HISTORY - 1),
});

/**
 * POST /api/vendor/sliders/[id]/restore — a past version becomes the DRAFT;
 * nothing goes live until it is published.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:restore" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid restore payload");
    const lookup = vendorSliderLookup(vendor._id, params.id);
    const stored = await VendorSlider.findOne(lookup).lean();
    if (!stored) throw new NotFoundError("Slider");
    const content = restoreSliderVersion(
      normalizeSliderDocument(stored),
      parsed.data.index,
    );
    if (!content) throw new ValidationError("No such version");
    const updated = await VendorSlider.findOneAndUpdate(
      lookup,
      {
        $set: {
          draft: {
            ...content,
            // A product sold on since that version is cleared, not revived.
            slides: await vendorSlides(content.slides, String(vendor._id)),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    return successResponse(normalizeSliderDocument(updated));
  },
);
