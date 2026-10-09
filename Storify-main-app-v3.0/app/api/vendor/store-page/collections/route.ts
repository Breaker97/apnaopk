import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

/**
 * The collections (and Looks) the signed-in vendor's products are in, busiest
 * first, in the `{ _id, title }` shape the builder's collection pickers read
 * (`/api/admin/collections` on the admin's side). Collections are the
 * marketplace's; on the vendor's page each one shows that store's products
 * alone, so a collection it sells nothing in would only draw an empty row.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:collections", preset: "lenient" },
  },
  async ({ session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const { collections } = await getVendorStoreTaxonomy(String(vendor._id));
    return successResponse(
      collections.map((collection) => ({
        _id: collection.id,
        title: collection.title,
        slug: collection.slug,
        kind: collection.kind,
        productCount: collection.productCount,
      })),
    );
  },
);
