import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { withApi } from "@/lib/api/handler";
import {
  listPOSProducts,
  POS_PRODUCT_PAGE_SIZE,
} from "@/lib/pos/list-products";
import { resolvePOSLocationId } from "@/lib/pos/resolve-location";
import type { POSStockStatusFilter } from "@/lib/pos/product-stock";

/**
 * GET /api/pos/products
 * Search products available for POS
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

  await connectDB();

  const { searchParams } = new URL(request.url);
  const stockStatusParam = searchParams.get("stockStatus") || "all";
  const stockStatus: POSStockStatusFilter =
    stockStatusParam === "in_stock" || stockStatusParam === "out_of_stock"
      ? stockStatusParam
      : "all";

  // `?ids=a,b,c` re-reads a known basket (resuming a held sale) rather than
  // browsing. Capped so a crafted URL cannot turn it into a bulk export.
  const idsParam = searchParams.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, POS_PRODUCT_PAGE_SIZE)
    : undefined;

  // The register echoes back the location the page resolved for it, but a
  // location id is a bare string with no ownership of its own. Re-resolving
  // means a crafted query cannot make this endpoint report stock against
  // another merchant's counter, and that the grid a filter change paints always
  // agrees with the one the server component rendered.
  //
  // Costs nothing while no default POS location is configured: the resolver
  // returns immediately on an empty id, so the common case adds no query.
  const locationId = await resolvePOSLocationId(
    session.user,
    searchParams.get("locationId") || "",
  );

  const data = await listPOSProducts(session.user, {
    ids,
    search: searchParams.get("search") || "",
    categoryId: searchParams.get("category") || "",
    locationId,
    stockStatus,
    limit: Number(searchParams.get("limit")) || POS_PRODUCT_PAGE_SIZE,
  });

  return successResponse(data);
});
