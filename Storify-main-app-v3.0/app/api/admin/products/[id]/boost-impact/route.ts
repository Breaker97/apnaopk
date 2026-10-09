import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { connectDB } from "@/lib/db";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { Product } from "@/models";
import { previewBoostReleaseForProduct } from "@/lib/boosts/boosts";

type RouteParams = { id: string };

/**
 * GET /api/admin/products/[id]/boost-impact
 *
 * The admin twin of the vendor endpoint. Both exist because the product form is
 * SHARED: it posts to `/api/admin/products` or `/api/vendor/products` depending
 * on who opened it, and the impact check has to follow the same split.
 *
 * Without this the admin path failed its permission check, the client swallowed
 * the error, and an admin unpublishing a booked product released every future
 * day with no warning at all — the precise outcome the confirmation exists to
 * prevent, silently, for the role most likely to do it.
 */
export const GET = withApi<RouteParams>(
  { auth: "user" },
  async ({ params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_PRODUCTS],
    );

    await connectDB();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    // Staff see only the vendors they are scoped to, exactly as the product
    // routes do — the impact report must not answer for a product its caller
    // cannot otherwise read.
    const product = await Product.exists(
      mergeScopeFilter(
        { _id: id },
        buildStaffProductScopeFilter(access.staffScope),
      ),
    );
    if (!product) return notFoundResponse("Product");

    return successResponse(await previewBoostReleaseForProduct(id));
  },
);
