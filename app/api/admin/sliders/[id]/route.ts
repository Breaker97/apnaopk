import mongoose from "mongoose";
import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateSliderSchema } from "@/lib/validations";
import {
  migrateSlidesV1,
  normalizeSliderControls,
  normalizeSliderDocument,
  normalizeSlides,
  SLIDER_DOCUMENT_VERSION,
} from "@/lib/sliders/types";
import { sliderContentFromInput } from "@/lib/sliders/document-ops";
import { revalidateSliderContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

/** Accepts either an ObjectId or a handle, like the menu routes. */
export function getSliderLookup(key: string) {
  const decoded = decodeURIComponent(key).trim();
  if (mongoose.Types.ObjectId.isValid(decoded)) {
    return { _id: decoded };
  }
  const handle = slugify(decoded);
  if (!handle) {
    throw new ValidationError("Invalid slider id or handle");
  }
  return { handle };
}

export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const slider = await Slider.findOne(getSliderLookup(params.id)).lean();
    if (!slider) throw new NotFoundError("Slider");
    // Read through the one normalizer: a pre-version-2 document comes back
    // with its numbers migrated, exactly as the storefront reads it.
    return successResponse(normalizeSliderDocument(slider));
  },
);

/**
 * PUT: name, active flag, and either the LIVE content (`slides`,
 * `transition`, `autoplaySeconds`, `controls` — what the storefront shows)
 * or a `draft` of it. The editor saves drafts; publishing is its own verb.
 *
 * A document still at version 1 is migrated in the same write whenever it
 * is touched, so a draft written against version-2 numbers never sits
 * beside live numbers that mean something else.
 */
export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const lookup = getSliderLookup(params.id);
    const current = await Slider.findOne(lookup)
      .select("_id version slides")
      .lean();
    if (!current) throw new NotFoundError("Slider");

    const body = await request.json();
    const parsed = UpdateSliderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid slider payload");
    }
    // Only write back what the caller sent — `.partial()` keeps the base
    // schema's `.default()` values, which would otherwise overwrite
    // untouched fields on a partial update.
    const data: Record<string, unknown> = pickSubmittedKeys(body, parsed.data);
    const set: Record<string, unknown> = {};
    for (const key of ["name", "isActive", "transition", "autoplaySeconds"] as const) {
      if (data[key] !== undefined) set[key] = data[key];
    }
    if (Array.isArray(data.slides)) {
      set.slides = normalizeSlides(data.slides);
      set.version = SLIDER_DOCUMENT_VERSION;
    }
    if (data.controls !== undefined) {
      set.controls = normalizeSliderControls(data.controls);
    }
    if (data.draft !== undefined) {
      set.draft = {
        ...sliderContentFromInput(data.draft),
        updatedAt: new Date().toISOString(),
      };
    }
    // Touching an old document migrates its live numbers along with it.
    const storedVersion =
      typeof current.version === "number" ? current.version : 1;
    if (storedVersion < SLIDER_DOCUMENT_VERSION && !Array.isArray(set.slides)) {
      set.slides = migrateSlidesV1(normalizeSlides(current.slides));
      set.version = SLIDER_DOCUMENT_VERSION;
    }
    if (data.name && !data.handle) {
      // Renaming keeps the handle: sections reference sliders by handle, so
      // a rename must never orphan them.
      delete data.handle;
    } else if (typeof data.handle === "string" && data.handle) {
      const candidate = slugify(data.handle);
      if (candidate) {
        const exists = await Slider.findOne({
          handle: candidate,
          _id: { $ne: current._id },
        });
        set.handle = exists ? `${candidate}-${Date.now()}` : candidate;
      }
    }
    const slider = await Slider.findOneAndUpdate(
      lookup,
      { $set: set },
      { returnDocument: "after" },
    ).lean();
    if (!slider) throw new NotFoundError("Slider");
    // A draft never reaches the shop; only live content invalidates it.
    if (set.slides || set.transition || set.autoplaySeconds || set.controls || set.isActive !== undefined) {
      revalidateSliderContent();
    }
    return successResponse(normalizeSliderDocument(slider));
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const slider = await Slider.findOne(getSliderLookup(params.id))
      .select("_id")
      .lean();
    if (!slider) throw new NotFoundError("Slider");
    await Slider.findByIdAndDelete(slider._id);
    revalidateSliderContent();
    return successResponse({ deleted: true });
  },
);
