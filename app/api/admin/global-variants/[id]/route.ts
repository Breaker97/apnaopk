import mongoose from "mongoose";
import { GlobalVariant } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { normalizeGlobalVariantInput } from "@/lib/catalog/global-variants";

type RouteParams = { id: string };

/**
 * GET /api/admin/global-variants/[id]
 */
export const GET = withApi<RouteParams>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  },
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Global variant");
    }
    const variant = await GlobalVariant.findById(id).lean();
    if (!variant) return notFoundResponse("Global variant");
    return successResponse(variant);
  }
);

/**
 * PUT /api/admin/global-variants/[id]
 * Update a global variant. Also handles lightweight reordering when the body
 * only carries a `position`.
 */
export const PUT = withApi<RouteParams>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
    ],
  },
  async ({ request, params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Global variant");
    }

    const body = await request.json();

    // Reorder-only payload: `{ position }` without other fields.
    if (
      typeof body.position === "number" &&
      body.name === undefined &&
      body.values === undefined
    ) {
      const reordered = await GlobalVariant.findByIdAndUpdate(
        id,
        { $set: { position: body.position } },
        { returnDocument: "after" }
      );
      if (!reordered) return notFoundResponse("Global variant");
      return successResponse(reordered);
    }

    const input = normalizeGlobalVariantInput(body);
    if (!input.name) {
      throw new ValidationError("Variant name is required");
    }

    const variant = await GlobalVariant.findByIdAndUpdate(
      id,
      { $set: input },
      { returnDocument: "after", runValidators: true }
    );
    if (!variant) return notFoundResponse("Global variant");
    return successResponse(variant);
  }
);

/**
 * DELETE /api/admin/global-variants/[id]
 * Hard-delete a global variant. Products that were built from it keep their
 * own copied options, so nothing on existing products changes.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      STAFF_PERMISSIONS.DELETE_PRODUCTS,
    ],
  },
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Global variant");
    }
    const variant = await GlobalVariant.findByIdAndDelete(id);
    if (!variant) return notFoundResponse("Global variant");
    return successResponse({ message: "Global variant deleted" });
  }
);
