import { GlobalVariant } from "@/models";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/global-variants
 * Active global variants, for the product form's "Add from global variants"
 * picker. Available to any authenticated author (admin, staff, or vendor)
 * — unlike the /api/admin management routes, this is read-only and scoped to
 * assignable (active) variants.
 */
export const GET = withApi({ auth: "user" }, async () => {
  const variants = await GlobalVariant.find({ isActive: true })
    .sort({ position: 1, createdAt: 1 })
    .lean();
  return successResponse(variants);
});
