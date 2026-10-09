import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId } from "@/lib/api/validate";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { isAdmin } from "@/lib/access/rbac";
import { Product } from "@/models";
import { getSettings } from "@/models/settings.model";
import { buildProductFormOptions } from "@/lib/products/form-options";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { ensureDefaultVendorId } from "@/lib/vendors/multi-vendor";
import {
  adminProductCreateVendorId,
  productStockScope,
  resolveLocationScope,
  storeProfileUnavailable,
} from "@/lib/inventory/inventory-location-scope";

/**
 * GET /api/admin/products/form-options[?productId=…]
 *
 * Every dropdown the admin/staff product editor needs, in one projected
 * payload: categories (with breadcrumb paths and variant templates), assignable
 * brands, active collections, inventory locations and the shipping context.
 *
 * The locations are the product OWNER's — the product being edited, or the
 * vendor a new one will be created under — exactly the shelves the save
 * accepts. The editor's own store is the wrong list whenever the two differ:
 * an admin editing a vendor's product was offered the house warehouse, and the
 * save then deleted the vendor's own counts.
 *
 * Gated like the product read itself (VIEW_PRODUCTS), since it only exposes
 * reference data an editor already sees.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const access = await assertAdminOrStaffPermissions(
    session as unknown as { user: { id: string; role: string } },
    [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  );

  await rateLimitByUser(
    request,
    session.user.id,
    "admin:products:form-options",
    "lenient",
    session.user.role,
  );

  const productId = request.nextUrl.searchParams.get("productId");
  const product =
    productId && isValidObjectId(productId)
      ? await Product.findOne(
          mergeScopeFilter(
            { _id: productId },
            buildStaffProductScopeFilter(access.staffScope),
          ),
        )
          .select("vendorId")
          .lean<{ vendorId?: unknown } | null>()
      : null;
  // The house profile is made here on first need: on a store installed without
  // demo data it did not exist, and its absence emptied the categories, brands
  // and collections too, though only the locations depend on it.
  let ownerVendorId =
    (product?.vendorId ? String(product.vendorId) : null) ??
    adminProductCreateVendorId(access.staffScope);
  if (!ownerVendorId) {
    const house = await ensureDefaultVendorId({
      preferredOwnerId: session.user.id,
    });
    if (!house.vendorId) throw storeProfileUnavailable(house.problem);
    ownerVendorId = house.vendorId;
  }

  const scope = productStockScope(ownerVendorId, access.staffScope?.locationIds);
  const callerScope = await resolveLocationScope(session.user, "write");

  return successResponse(
    await buildProductFormOptions({
      includeInactiveCategories: isAdmin(session.user),
      scope,
      canCreateLocations: callerScope.vendorId === ownerVendorId,
      deferredBalanceSupported: storeCanCollectDeferredBalance(
        (await getSettings()).payment,
      ),
    }),
  );
});
