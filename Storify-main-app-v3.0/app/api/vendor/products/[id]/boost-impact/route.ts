import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { Product } from "@/models";
import { previewBoostReleaseForProduct } from "@/lib/boosts/boosts";

type RouteParams = { id: string };

/**
 * GET /api/vendor/products/[id]/boost-impact
 *
 * What unpublishing or archiving this product would cost: the booked days that
 * would go back on the calendar, and the credit they represent.
 *
 * The release itself is immediate and irreversible — a released day is on sale
 * again the same second, and a competitor can take it before the vendor changes
 * their mind — so the vendor has to see the number BEFORE they commit. That is
 * the whole reason this endpoint exists rather than a toast afterwards.
 *
 * Boosting off, no bookings, or no permission all answer the same empty shape,
 * so the caller never has to branch on the feature being enabled.
 */
export const GET = withApi<RouteParams>(
  { auth: "user" },
  async ({ params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_BOOSTS,
      "You do not have permission to view boosts",
    );

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const owned = await Product.exists({ _id: id, vendorId: vendor._id });
    if (!owned) return notFoundResponse("Product");

    return successResponse(await previewBoostReleaseForProduct(id));
  },
);
