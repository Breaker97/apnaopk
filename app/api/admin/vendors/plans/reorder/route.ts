import * as z from "zod";
import { VendorPlan } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { mergePlanOrder } from "@/lib/vendors/vendor-plan-order";

async function assertPlansEnabled() {
  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.vendorConfig?.plansEnabled) {
    throw new NotFoundError("Vendor plans");
  }
}

const ReorderVendorPlansSchema = z.object({
  ids: z
    .array(z.string().refine((id) => isValidObjectId(id), "Invalid plan id"))
    .min(1, "Send the plans in their new order")
    .max(200),
});

/**
 * PUT /api/admin/vendors/plans/reorder
 * Saves the order vendors see plans in, from a drag on the admin catalogue.
 * `ids` is the new order; every plan's `sortOrder` becomes its position, so the
 * order no longer depends on hand-typed numbers that could tie.
 */
export const PUT = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:reorder", preset: "moderate" },
  },
  async ({ request, session }) => {
    await assertPlansEnabled();
    const { ids } = await validateBody(request, ReorderVendorPlansSchema);

    const plans = await VendorPlan.find()
      .sort({ sortOrder: 1, createdAt: -1 })
      .select("_id name sortOrder")
      .lean();
    const byId = new Map(plans.map((plan) => [String(plan._id), plan]));
    const order = mergePlanOrder(
      plans.map((plan) => String(plan._id)),
      ids,
    );

    const moves = order
      .map((id, position) => ({
        id,
        before: byId.get(id)?.sortOrder ?? 0,
        after: position,
      }))
      .filter((move) => move.before !== move.after);

    if (moves.length > 0) {
      await VendorPlan.bulkWrite(
        moves.map((move) => ({
          updateOne: {
            filter: { _id: move.id },
            update: { $set: { sortOrder: move.after } },
          },
        })),
      );

      const auditContext = createAuditContext(request, session);
      await Promise.all(
        moves.map((move) =>
          auditUpdate(
            auditContext,
            "vendorPlan",
            move.id,
            { sortOrder: move.before },
            { sortOrder: move.after },
            byId.get(move.id)?.name,
          ),
        ),
      );
    }

    return successResponse({ order });
  },
);
