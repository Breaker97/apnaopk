import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateQuery } from "@/lib/api/validate";
import {
  CollectionProductsQuerySchema,
  readCollectionPickerProducts,
} from "@/lib/catalog/collection-picker-products";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/collections/[id]/products
 *
 * The products a collection puts on the online store, in the collection's own
 * order, and which of `picked=<id>,<id>` it still offers — see
 * `readCollectionPickerProducts`.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:read", preset: "lenient" },
  },
  async ({ request, params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Collection");
    const query = validateQuery(request, CollectionProductsQuerySchema);
    const result = await readCollectionPickerProducts(id, query);
    return result ? successResponse(result) : notFoundResponse("Collection");
  },
);
