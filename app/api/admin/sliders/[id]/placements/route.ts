import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { findSliderPlacements, type SliderPlacement } from "@/lib/sliders/placements";
import { getSliderLookup } from "../route";

export type { SliderPlacement };

export interface SliderPlacementsResponse {
  handle: string;
  placements: SliderPlacement[];
}

/**
 * GET /api/admin/sliders/[id]/placements — where this slider actually
 * appears on the shop, and the frame it renders at in each place.
 *
 * The editor asks so it can open on a real frame instead of one of three
 * fixed artboards. Before this existed, sections referenced a slider one
 * way and nothing could answer the question at all.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const slider = await Slider.findOne(getSliderLookup(params.id))
      .select("handle")
      .lean();
    if (!slider) throw new NotFoundError("Slider");
    const handle = String(slider.handle ?? "");
    const placements = await findSliderPlacements(handle);
    return successResponse({ handle, placements } satisfies SliderPlacementsResponse);
  },
);
