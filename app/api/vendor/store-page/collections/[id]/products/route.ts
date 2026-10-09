import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateQuery } from "@/lib/api/validate";
import {
  CollectionProductsQuerySchema,
  readCollectionPickerProducts,
} from "@/lib/catalog/collection-picker-products";
import { withApi } from "@/lib/api/handler";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

/**
 * GET /api/vendor/store-page/collections/[id]/products
 *
 * The admin route's answer (`readCollectionPickerProducts`) narrowed to the
 * signed-in vendor's own products: what a Featured Collection row on their
 * landing page can place by hand.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:collection-products", preset: "lenient" },
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Collection");
    const query = validateQuery(request, CollectionProductsQuerySchema);
    const result = await readCollectionPickerProducts(id, {
      ...query,
      vendorId: String(vendor._id),
    });
    return result ? successResponse(result) : notFoundResponse("Collection");
  },
);
