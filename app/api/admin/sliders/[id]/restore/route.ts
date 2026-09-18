import { z } from "zod";
import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { MAX_SLIDER_HISTORY, normalizeSliderDocument } from "@/lib/sliders/types";
import { restoreSliderVersion } from "@/lib/sliders/document-ops";
import { getSliderLookup } from "../route";

const BodySchema = z.object({
  /** Position in the history, newest first. */
  index: z.number().int().min(0).max(MAX_SLIDER_HISTORY - 1),
});

/**
 * POST /api/admin/sliders/[id]/restore — a past version becomes the DRAFT.
 * Nothing goes live until it is published, so a restore is never a surprise
 * on the shop.
 */
export const POST = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid restore payload");
    const lookup = getSliderLookup(params.id);
    const stored = await Slider.findOne(lookup).lean();
    if (!stored) throw new NotFoundError("Slider");
    const content = restoreSliderVersion(normalizeSliderDocument(stored), parsed.data.index);
    if (!content) throw new ValidationError("No such version");
    const updated = await Slider.findOneAndUpdate(
      lookup,
      { $set: { draft: { ...content, updatedAt: new Date().toISOString() } } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    return successResponse(normalizeSliderDocument(updated));
  },
);
