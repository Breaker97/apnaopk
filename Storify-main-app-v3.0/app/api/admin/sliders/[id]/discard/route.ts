import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { audit, createAuditContext } from "@/lib/audit";
import { normalizeSliderDocument } from "@/lib/sliders/types";
import { getSliderLookup } from "../route";

/** POST /api/admin/sliders/[id]/discard — drops the draft; what is live stays. */
export const POST = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const lookup = getSliderLookup(params.id);
    // Asked first: discarding with no draft changes nothing, and writes no row.
    const hadDraft = await Slider.exists({ ...lookup, draft: { $type: "object" } });
    const updated = await Slider.findOneAndUpdate(
      lookup,
      { $unset: { draft: 1 } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    if (hadDraft) {
      await audit(createAuditContext(request, session), {
        action: "UPDATE",
        resource: "slider",
        resourceId: String(updated._id),
        resourceName: updated.name,
        changes: {
          fields: ["draft"],
          summary: `Discarded the draft of slider "${updated.name}"; the live version is unchanged`,
        },
      });
    }
    return successResponse(normalizeSliderDocument(updated));
  },
);
