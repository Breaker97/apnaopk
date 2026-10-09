import * as z from "zod";
import { Slider } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { audit, createAuditContext } from "@/lib/audit";
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
  async ({ request, params, session }) => {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid restore payload");
    const lookup = getSliderLookup(params.id);
    const stored = await Slider.findOne(lookup).lean();
    if (!stored) throw new NotFoundError("Slider");
    const doc = normalizeSliderDocument(stored);
    const content = restoreSliderVersion(doc, parsed.data.index);
    if (!content) throw new ValidationError("No such version");
    const updated = await Slider.findOneAndUpdate(
      lookup,
      { $set: { draft: { ...content, updatedAt: new Date().toISOString() } } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new NotFoundError("Slider");
    // A version is told apart by when it went live, which is what the history
    // stamps it with.
    const wentLive = doc.history?.[parsed.data.index]?.publishedAt?.slice(0, 10);
    const version = wentLive
      ? `the version of slider "${updated.name}" that went live on ${wentLive}`
      : `an earlier version of slider "${updated.name}"`;
    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "slider",
      resourceId: String(updated._id),
      resourceName: updated.name,
      changes: {
        fields: ["draft"],
        summary: `Restored ${version} into its draft; it goes live only when published`,
      },
    });
    return successResponse(normalizeSliderDocument(updated));
  },
);
