import { createdResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { sanitizeSearchString } from "@/lib/api/validate";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { CreateSliderSchema } from "@/lib/validations";
import { normalizeSliderControls, normalizeSlides, SLIDER_DOCUMENT_VERSION } from "@/lib/sliders/types";
import { sliderContentFromInput } from "@/lib/sliders/document-ops";
import { slugify } from "@/lib/strings";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import {
  VENDOR_SLIDER_LIMIT,
  vendorSlides,
} from "@/lib/vendors/vendor-sliders";
import { VendorSlider } from "@/models/vendor-slider.model";

/**
 * The signed-in vendor's own sliders (Online Store → Sliders). Same shapes
 * as /api/admin/sliders, so the admin's Sliders screen runs on them
 * unchanged; every read and write is limited to the vendor's documents.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "vendor:sliders:list", preset: "lenient" } },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const search = sanitizeSearchString(
      request.nextUrl.searchParams.get("search") || "",
    );
    const query: Record<string, unknown> = { vendorId: vendor._id };
    if (search) query.name = { $regex: search, $options: "i" };
    const items = await VendorSlider.find(query)
      .sort({ updatedAt: -1 })
      .limit(VENDOR_SLIDER_LIMIT)
      .lean();
    return successResponse(items);
  },
);

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:create" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const vendorId = String(vendor._id);

    const parsed = CreateSliderSchema.safeParse(await request.json());
    if (!parsed.success) throw new ValidationError("Invalid slider payload");
    const data = parsed.data;

    const count = await VendorSlider.countDocuments({ vendorId: vendor._id });
    if (count >= VENDOR_SLIDER_LIMIT) {
      throw new ValidationError(
        `A store can keep up to ${VENDOR_SLIDER_LIMIT} sliders — delete one to add another`,
      );
    }

    let handle = slugify(data.handle || data.name) || "slider";
    if (await VendorSlider.exists({ vendorId: vendor._id, handle })) {
      handle = `${handle}-${Date.now()}`;
    }

    const draft = data.draft
      ? sliderContentFromInput(data.draft)
      : undefined;
    const slider = await VendorSlider.create({
      vendorId: vendor._id,
      name: data.name,
      handle,
      isActive: data.isActive,
      transition: data.transition,
      autoplaySeconds: data.autoplaySeconds,
      controls: normalizeSliderControls(data.controls),
      slides: await vendorSlides(normalizeSlides(data.slides), vendorId),
      version: SLIDER_DOCUMENT_VERSION,
      ...(draft
        ? {
            draft: {
              ...draft,
              slides: await vendorSlides(draft.slides, vendorId),
              updatedAt: new Date().toISOString(),
            },
          }
        : {}),
    });
    return createdResponse(slider);
  },
);
