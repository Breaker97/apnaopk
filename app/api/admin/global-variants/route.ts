import { GlobalVariant } from "@/models";
import { successResponse, createdResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { normalizeGlobalVariantInput } from "@/lib/catalog/global-variants";

/**
 * GET /api/admin/global-variants
 * List every global variant (admin / product-managing staff), ordered for
 * the management screen.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  },
  async () => {
    const variants = await GlobalVariant.find({})
      .sort({ position: 1, createdAt: 1 })
      .lean();
    return successResponse(variants);
  }
);

/**
 * POST /api/admin/global-variants
 * Create a new reusable global variant.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
    ],
  },
  async ({ request }) => {
    const body = await request.json();
    const input = normalizeGlobalVariantInput(body);

    if (!input.name) {
      throw new ValidationError("Variant name is required");
    }

    // Place new variants at the end of the list.
    const last = await GlobalVariant.findOne({})
      .sort({ position: -1 })
      .select("position")
      .lean();
    const position = (last?.position ?? -1) + 1;

    const variant = await GlobalVariant.create({ ...input, position });
    return createdResponse(variant);
  }
);
