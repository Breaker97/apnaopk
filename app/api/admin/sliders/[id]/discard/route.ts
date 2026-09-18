import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { normalizeSliderDocument } from "@/lib/sliders/types";
import { getSliderLookup } from "../route";

/** POST /api/admin/sliders/[id]/discard — drops the draft; what is live stays. */
export const POST = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const lookup = getSliderLookup(params.id);
    const updated = await Slider.findOneAndUpdate(
      lookup,
      { $unset: { draft: 1 } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    return successResponse(normalizeSliderDocument(updated));
  },
);
