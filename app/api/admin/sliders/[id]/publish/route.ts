import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { normalizeSliderDocument, SLIDER_DOCUMENT_VERSION } from "@/lib/sliders/types";
import { publishSlider } from "@/lib/sliders/document-ops";
import { revalidateSliderContent } from "@/lib/cache-invalidation";
import { getSliderLookup } from "../route";

/**
 * POST /api/admin/sliders/[id]/publish — the draft goes live, what was live
 * goes to the head of the history. Without a draft the document comes back
 * unchanged.
 */
export const POST = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const lookup = getSliderLookup(params.id);
    const stored = await Slider.findOne(lookup).lean();
    if (!stored) throw new NotFoundError("Slider");
    const doc = normalizeSliderDocument(stored);
    const published = publishSlider(doc, new Date());
    if (!published) return successResponse(doc);
    const updated = await Slider.findOneAndUpdate(
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
    revalidateSliderContent();
    return successResponse(normalizeSliderDocument(updated));
  },
);
