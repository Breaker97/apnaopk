import mongoose from "mongoose";
import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateSliderSchema } from "@/lib/validations";
import { normalizeSlides } from "@/lib/sliders/types";
import { revalidateSliderContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

/** Accepts either an ObjectId or a handle, like the menu routes. */
function getSliderLookup(key: string) {
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
    return successResponse(slider);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const lookup = getSliderLookup(params.id);
    const current = await Slider.findOne(lookup).select("_id").lean();
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
    if (Array.isArray(data.slides)) {
      data.slides = normalizeSlides(data.slides);
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
        data.handle = exists ? `${candidate}-${Date.now()}` : candidate;
      } else {
        delete data.handle;
      }
    }
    const slider = await Slider.findOneAndUpdate(
      lookup,
      { $set: data },
      { new: true },
    ).lean();
    if (!slider) throw new NotFoundError("Slider");
    revalidateSliderContent();
    return successResponse(slider);
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
