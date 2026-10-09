import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { UpdateSliderSchema } from "@/lib/validations";
import {
  migrateSlidesV1,
  normalizeSliderControls,
  normalizeSliderDocument,
  normalizeSlides,
  SLIDER_DOCUMENT_VERSION,
} from "@/lib/sliders/types";
import { sliderContentFromInput } from "@/lib/sliders/document-ops";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import {
  revalidateVendorSliders,
  vendorSlides,
  vendorSliderLookup,
} from "@/lib/vendors/vendor-sliders";
import { VendorSlider } from "@/models/vendor-slider.model";

export const GET = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "vendor:sliders:read", preset: "lenient" } },
  async ({ params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const slider = await VendorSlider.findOne(
      vendorSliderLookup(vendor._id, params.id),
    ).lean();
    if (!slider) throw new NotFoundError("Slider");
    return successResponse(normalizeSliderDocument(slider));
  },
);

/**
 * PUT: name, active flag, and either the live content or a `draft` of it —
 * the admin route's contract. The handle never changes on a rename: the
 * landing page refers to sliders by handle.
 */
export const PUT = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:update" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const vendorId = String(vendor._id);
    const lookup = vendorSliderLookup(vendor._id, params.id);
    const current = await VendorSlider.findOne(lookup)
      .select("_id version slides")
      .lean();
    if (!current) throw new NotFoundError("Slider");

    const body = await request.json();
    const parsed = UpdateSliderSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError("Invalid slider payload");
    const data: Record<string, unknown> = pickSubmittedKeys(body, parsed.data);

    const set: Record<string, unknown> = {};
    for (const key of ["name", "isActive", "transition", "autoplaySeconds"] as const) {
      if (data[key] !== undefined) set[key] = data[key];
    }
    if (Array.isArray(data.slides)) {
      set.slides = await vendorSlides(normalizeSlides(data.slides), vendorId);
      set.version = SLIDER_DOCUMENT_VERSION;
    }
    if (data.controls !== undefined) {
      set.controls = normalizeSliderControls(data.controls);
    }
    if (data.draft !== undefined) {
      const draft = sliderContentFromInput(data.draft);
      set.draft = {
        ...draft,
        slides: await vendorSlides(draft.slides, vendorId),
        updatedAt: new Date().toISOString(),
      };
    }
    const storedVersion =
      typeof current.version === "number" ? current.version : 1;
    if (storedVersion < SLIDER_DOCUMENT_VERSION && !Array.isArray(set.slides)) {
      set.slides = migrateSlidesV1(normalizeSlides(current.slides));
      set.version = SLIDER_DOCUMENT_VERSION;
    }

    const slider = await VendorSlider.findOneAndUpdate(
      lookup,
      { $set: set },
      { returnDocument: "after" },
    ).lean();
    if (!slider) throw new NotFoundError("Slider");
    // A draft never reaches the shop; only live content does.
    if (
      set.slides ||
      set.transition ||
      set.autoplaySeconds ||
      set.controls ||
      set.isActive !== undefined
    ) {
      revalidateVendorSliders(vendorId);
    }
    return successResponse(normalizeSliderDocument(slider));
  },
);

export const DELETE = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:sliders:delete" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const deleted = await VendorSlider.findOneAndDelete(
      vendorSliderLookup(vendor._id, params.id),
    )
      .select("_id")
      .lean();
    if (!deleted) throw new NotFoundError("Slider");
    revalidateVendorSliders(String(vendor._id));
    return successResponse({ deleted: true });
  },
);
